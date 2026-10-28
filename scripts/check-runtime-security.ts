/**
 * Runtime security check — the part Dependabot can't see.
 *
 *   pnpm tsx scripts/check-runtime-security.ts [--strict] [--os] [--db] [--docker]
 *     [--tls host,…] [--backup dir/prefix …] [--pm2 <app>]
 *
 * Checks:
 *   • Node.js — the binary running this script (= the nvm default the deploy
 *     builds with) and, with `--pm2 <app>`, the binaries the PM2 workers
 *     actually run. Those can differ: dump.pm2 pins `exec_interpreter` to an
 *     absolute path and `pm2 reload` keeps it (docs/deployment.md). Each is
 *     compared with the newest security release of its major line from
 *     nodejs.org/dist/index.json.
 *   • `--os` (Linux) — Ubuntu release still supported (`ubuntu-distro-info
 *     --supported`), no pending upgrades from a `-security` pocket, and none
 *     from repositories outside Ubuntu (PGDG, Docker…), which have no such
 *     pocket to tell a security fix apart — and no installed package that
 *     no repository offers any more (an orphan never shows as upgradable).
 *   • `--db` — database extensions (PostGIS, pg_trgm…) whose version in the
 *     DB lags the installed package (needs DATABASE_URL, read from .env;
 *     only reads the extension catalogue).
 *   • `--tls host[,host…]` — certificate of each host:443 valid (chain) and
 *     not expiring within CERT_WARN_DAYS (certbot renews at 30: below 21
 *     its renewal is failing). Connects to our own domains only.
 *   • `--backup <dir>/<prefix>` (repeatable) — the newest file of that kind
 *     is at most BACKUP_MAX_AGE_HOURS old, e.g.
 *     `--backup /var/backups/postgres/ctyrlistkoteka-`.
 *   • `--docker` — every RUNNING container's image vs. what its tag points
 *     to in the registry now (manifest digest via an anonymous HEAD). Only
 *     the image name and tag go out, to that image's own registry.
 *     Both matter: an EOL release gets no new security packages, so "no
 *     pending security upgrades" alone would read as green forever.
 *
 * Exit code: 0 by default (findings are printed as GitHub `::warning::`
 * annotations — used by the deploy, which must never fail on this); with
 * `--strict` 1 on any finding or check that could not run (the weekly
 * workflow, so a failed run e-mails the owner).
 *
 * Outbound: a GET of nodejs.org/dist/index.json, and with `--docker` an
 * anonymous manifest HEAD (+ token) per image at its registry — no project
 * data leaves the machine (CLAUDE.md §9).
 */

import { execFile } from "node:child_process";
import { readdir, readFile, readlink, stat } from "node:fs/promises";
import path from "node:path";
import { connect as tlsConnect } from "node:tls";
import { promisify } from "node:util";
import {
  assessNode,
  isCodenameSupported,
  isImageCurrent,
  osCodename,
  parseBearerChallenge,
  parseImageRef,
  formatResult,
  type CheckCategory,
  type ImageRef,
  securityUpgrades,
  BACKUP_MAX_AGE_HOURS,
  CERT_WARN_DAYS,
  certDaysLeft,
  newestWithPrefix,
  orphanedPackages,
  outdatedExtensions,
  type ExtensionRow,
  thirdPartyUpgrades,
  type NodeRelease,
} from "./runtime-security";

const run = promisify(execFile);

const NODE_INDEX_URL = "https://nodejs.org/dist/index.json";
const FETCH_TIMEOUT_MS = 15_000;
const EXEC_TIMEOUT_MS = 30_000;
// A full-upgrade simulation lists every package; execFile's 1 MB default
// could cut it off on a stale host.
const APT_SIM_MAX_BUFFER = 16 * 1024 * 1024;

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const checkOs = args.includes("--os");
const checkDocker = args.includes("--docker");
const checkDb = args.includes("--db");
/** Values of a repeatable `--flag value` / `--flag a,b` argument. */
function listArg(flag: string): string[] {
  const out: string[] = [];
  args.forEach((a, i) => {
    if (a === flag && args[i + 1]) out.push(...args[i + 1]!.split(",").filter(Boolean));
  });
  return out;
}
const tlsHosts = listArg("--tls");
const backupSpecs = listArg("--backup");
const pm2Index = args.indexOf("--pm2");
const pm2App = pm2Index >= 0 ? args[pm2Index + 1] : undefined;
const inActions = process.env.GITHUB_ACTIONS === "true";

let findings = 0;

function finding(category: CheckCategory, message: string): void {
  findings++;
  console.log(formatResult("finding", category, message, { inActions, strict }));
}

function ok(category: CheckCategory, message: string): void {
  console.log(formatResult("ok", category, message, { inActions, strict }));
}

async function fetchNodeReleases(): Promise<NodeRelease[]> {
  const res = await fetch(NODE_INDEX_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error("index.json is not an array");
  return body.filter(
    (r): r is NodeRelease =>
      typeof r === "object" &&
      r !== null &&
      typeof (r as NodeRelease).version === "string" &&
      typeof (r as NodeRelease).security === "boolean",
  );
}

/** label → Node version of each running PM2 worker of `app`. */
async function pm2NodeVersions(app: string): Promise<Map<string, string>> {
  const { stdout } = await run("pm2", ["jlist"], { timeout: EXEC_TIMEOUT_MS });
  const procs = JSON.parse(stdout) as { name?: string; pid?: number }[];
  const pids = procs.flatMap((p) => (p.name === app && p.pid ? [p.pid] : []));
  if (pids.length === 0) throw new Error(`no running PM2 process named "${app}"`);

  const versions = new Map<string, string>();
  for (const pid of pids) {
    // The kernel's view of the binary, not what dump.pm2 claims.
    const exe = await readlink(`/proc/${pid}/exe`);
    const { stdout: v } = await run(exe, ["-v"], { timeout: EXEC_TIMEOUT_MS });
    versions.set(`PM2 ${app} pid ${pid}`, v.trim());
  }
  return versions;
}

async function checkNode(): Promise<void> {
  let releases: NodeRelease[];
  try {
    releases = await fetchNodeReleases();
  } catch (err) {
    finding("node", `Node.js check could not run: ${NODE_INDEX_URL}: ${(err as Error).message}`);
    return;
  }

  const versions = new Map<string, string>([["script runtime", process.version]]);
  if (pm2App) {
    // A failure here must not hide the result for the script runtime.
    try {
      for (const [label, v] of await pm2NodeVersions(pm2App)) versions.set(label, v);
    } catch (err) {
      finding("pm2-node", `PM2 worker Node.js check could not run: ${(err as Error).message}`);
    }
  }

  for (const [label, version] of versions) {
    const category: CheckCategory = label === "script runtime" ? "node" : "pm2-node";
    const a = assessNode(version, releases);
    if (a.status === "ok") {
      ok(category, `Node.js ${a.current} (${label}) — newest in line ${a.latestInLine}`);
    } else if (a.status === "vulnerable") {
      finding(
        category,
        `Node.js ${a.current} (${label}) is older than security release ${a.latestSecurity} — upgrade to ${a.latestInLine} (docs/deployment.md, "Upgrade Node.js")`,
      );
    } else {
      finding(category, `Node.js ${a.current} (${label}) could not be assessed: ${a.reason}`);
    }
  }
}

async function checkUbuntu(): Promise<void> {
  try {
    const codename = osCodename(await readFile("/etc/os-release", "utf8"));
    if (!codename) throw new Error("no VERSION_CODENAME in /etc/os-release");
    const { stdout } = await run("ubuntu-distro-info", ["--supported"], {
      timeout: EXEC_TIMEOUT_MS,
    });
    if (isCodenameSupported(codename, stdout)) {
      ok("os-release", `Ubuntu "${codename}" is a supported release`);
    } else {
      finding(
        "os-release",
        `Ubuntu "${codename}" is no longer supported — it receives no security updates; upgrade the release`,
      );
    }
  } catch (err) {
    finding("os-release", `Ubuntu support check could not run: ${(err as Error).message}`);
  }

  try {
    // Reads the local package lists only (no sudo, no network); they are as
    // fresh as the last `apt update` / apt-daily timer run.
    const { stdout } = await run("apt", ["list", "--upgradable"], {
      timeout: EXEC_TIMEOUT_MS,
    });
    const pending = securityUpgrades(stdout);
    if (pending.length === 0) {
      ok("apt-security", "No pending security upgrades from apt");
    } else {
      finding("apt-security", `${pending.length} apt security upgrade(s) pending: ${pending.join(", ")}`);
    }

  } catch (err) {
    finding("apt-security", `apt security check could not run: ${(err as Error).message}`);
  }

  try {
    // Simulation only — no root, no lock, nothing installed; same local
    // package lists as above.
    const { stdout } = await run("apt-get", ["-s", "dist-upgrade"], {
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: APT_SIM_MAX_BUFFER,
    });
    const foreign = thirdPartyUpgrades(stdout);
    if (foreign.length === 0) {
      ok("apt-foreign", "No pending upgrades from repositories outside Ubuntu");
    } else {
      finding(
        "apt-foreign",
        `${foreign.length} upgrade(s) pending from repositories outside Ubuntu (no -security pocket there — any may be a security fix): ${foreign.join(", ")}`,
      );
    }
  } catch (err) {
    finding("apt-foreign", `Check of repositories outside Ubuntu could not run: ${(err as Error).message}`);
  }

  try {
    const { stdout } = await run("apt", ["list", "--installed"], {
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: APT_SIM_MAX_BUFFER,
    });
    const orphans = orphanedPackages(stdout);
    if (orphans.length === 0) {
      ok("apt-orphaned", "Every installed package comes from a configured repository");
    } else {
      finding(
        "apt-orphaned",
        `${orphans.length} installed package(s) no repository offers any more — they get no updates (re-add the repo, or remove them): ${orphans.join(", ")}`,
      );
    }
  } catch (err) {
    finding("apt-orphaned", `Orphaned package check could not run: ${(err as Error).message}`);
  }
}

/** Manifest media types a tag may resolve to — an index first, so the
 *  digest is the multi-arch one `docker pull` records in RepoDigests. */
const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
].join(",");

/** Digest the tag points to now. Anonymous: a HEAD, and on a Bearer
 *  challenge one token GET from the realm the registry names (https only). */
async function remoteDigest(ref: ImageRef): Promise<string> {
  const url = `https://${ref.registry}/v2/${ref.repository}/manifests/${encodeURIComponent(ref.tag)}`;
  const head = (auth?: string) =>
    fetch(url, {
      method: "HEAD",
      headers: { Accept: MANIFEST_ACCEPT, ...(auth ? { Authorization: auth } : {}) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

  let res = await head();
  if (res.status === 401) {
    const challenge = parseBearerChallenge(res.headers.get("www-authenticate") ?? "");
    if (!challenge) throw new Error("registry asks for an unsupported login");
    const tokenUrl = new URL(challenge.realm);
    if (challenge.service) tokenUrl.searchParams.set("service", challenge.service);
    tokenUrl.searchParams.set("scope", challenge.scope ?? `repository:${ref.repository}:pull`);
    const tokenRes = await fetch(tokenUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!tokenRes.ok) throw new Error(`token endpoint: HTTP ${tokenRes.status}`);
    const body = (await tokenRes.json()) as { token?: unknown; access_token?: unknown };
    const token = typeof body.token === "string" ? body.token : body.access_token;
    if (typeof token !== "string") throw new Error("token endpoint returned no token");
    res = await head(`Bearer ${token}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const digest = res.headers.get("docker-content-digest");
  if (!digest?.startsWith("sha256:")) throw new Error("no Docker-Content-Digest header");
  return digest;
}

async function checkDockerImages(): Promise<void> {
  let containers: { name: string; image: string; imageId: string }[];
  try {
    const { stdout: ids } = await run("docker", ["ps", "-q"], { timeout: EXEC_TIMEOUT_MS });
    const idList = ids.split("\n").filter(Boolean);
    if (idList.length === 0) {
      ok("docker", "No running Docker containers");
      return;
    }
    const { stdout } = await run(
      "docker",
      ["inspect", "--format", "{{.Name}}\t{{.Config.Image}}\t{{.Image}}", ...idList],
      { timeout: EXEC_TIMEOUT_MS },
    );
    containers = stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name = "", image = "", imageId = ""] = line.split("\t");
        return { name: name.replace(/^\//, ""), image, imageId };
      });
  } catch (err) {
    finding("docker", `Docker image check could not run: ${(err as Error).message}`);
    return;
  }

  for (const c of containers) {
    const parsed = parseImageRef(c.image);
    if (parsed.kind === "pinned") {
      ok("docker", `Docker ${c.name}: ${c.image} is pinned by digest — update it by hand`);
      continue;
    }
    if (parsed.kind === "invalid") {
      finding("docker", `Docker ${c.name}: image reference "${c.image}" could not be read`);
      continue;
    }
    try {
      const { stdout } = await run(
        "docker",
        ["image", "inspect", "--format", "{{json .RepoDigests}}", c.imageId],
        { timeout: EXEC_TIMEOUT_MS },
      );
      const repoDigests = JSON.parse(stdout) as unknown;
      const local = Array.isArray(repoDigests)
        ? repoDigests.filter((d): d is string => typeof d === "string")
        : [];
      const remote = await remoteDigest(parsed.ref);
      if (isImageCurrent(local, remote)) {
        ok("docker", `Docker ${c.name}: ${c.image} is current`);
      } else {
        finding(
          "docker",
          `Docker ${c.name}: ${c.image} has a newer image in the registry (${remote.slice(0, 19)}…) — docker pull + recreate the container`,
        );
      }
    } catch (err) {
      finding("docker", `Docker ${c.name}: ${c.image} could not be checked: ${(err as Error).message}`);
    }
  }
}

async function checkDbExtensions(): Promise<void> {
  try {
    await import("dotenv/config");
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
    // Imported only with --db: the deploy's check must not need a database.
    const { createPrismaClient } = await import("../src/lib/prismaClient");
    const prisma = createPrismaClient({ max: 1 });
    try {
      const rows = await prisma.$queryRaw<ExtensionRow[]>`
        SELECT name, default_version, installed_version
        FROM pg_available_extensions
        WHERE installed_version IS NOT NULL
        ORDER BY name`;
      const behind = outdatedExtensions(rows);
      if (behind.length === 0) {
        ok("db-extensions", `Database extensions match their packages (${rows.map((r) => `${r.name} ${r.installed_version}`).join(", ")})`);
      } else {
        finding(
          "db-extensions",
          `Database extension(s) behind the installed package — run ALTER EXTENSION … UPDATE (PostGIS: SELECT postgis_extensions_upgrade();): ${behind.map((e) => `${e.name} ${e.installed} → ${e.available}`).join(", ")}`,
        );
      }
    } finally {
      await prisma.$disconnect();
    }
  } catch (err) {
    // Prisma's message is multi-line ("Invalid … invocation:\n\n…Can't
    // reach database server at host:port") — fold it onto one line. It
    // names host and port, never the password.
    const why = (err as Error).message.replace(/\s+/g, " ").trim() || (err as Error).name;
    finding("db-extensions", `Database extension check could not run: ${why}`);
  }
}

/** Peer certificate's expiry (and whether the chain verified) for host:443. */
function peerCertificate(host: string): Promise<{ validTo: Date; authorized: boolean; error: string | null }> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({ host, port: 443, servername: host, rejectUnauthorized: false });
    socket.setTimeout(FETCH_TIMEOUT_MS, () => socket.destroy(new Error("timeout")));
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      const result = {
        validTo: new Date(cert.valid_to),
        authorized: socket.authorized,
        error: socket.authorizationError ? String(socket.authorizationError) : null,
      };
      socket.end();
      resolve(result);
    });
    socket.once("error", reject);
  });
}

async function checkTls(): Promise<void> {
  for (const host of tlsHosts) {
    try {
      const c = await peerCertificate(host);
      const days = certDaysLeft(c.validTo, new Date());
      if (!c.authorized) {
        finding("tls", `TLS ${host}: certificate does not verify (${c.error ?? "unknown"})`);
      } else if (days < CERT_WARN_DAYS) {
        finding("tls", `TLS ${host}: certificate expires in ${days} day(s) — certbot renewal is failing (sudo certbot renew --dry-run)`);
      } else {
        ok("tls", `TLS ${host}: certificate valid for ${days} more days`);
      }
    } catch (err) {
      finding("tls", `TLS ${host}: could not connect: ${(err as Error).message}`);
    }
  }
}

async function checkBackups(): Promise<void> {
  for (const spec of backupSpecs) {
    const dir = path.dirname(spec);
    const prefix = path.basename(spec);
    try {
      const names = await readdir(dir);
      const files = await Promise.all(
        names.map(async (name) => ({ name, mtimeMs: (await stat(path.join(dir, name))).mtimeMs })),
      );
      const newest = newestWithPrefix(files, prefix);
      if (!newest) {
        finding("backups", `Backup ${spec}*: none found`);
        continue;
      }
      const hours = (Date.now() - newest.mtimeMs) / 3_600_000;
      if (hours > BACKUP_MAX_AGE_HOURS) {
        finding("backups", `Backup ${spec}*: newest (${newest.name}) is ${Math.round(hours)} h old — the nightly job stopped`);
      } else {
        ok("backups", `Backup ${spec}*: newest ${newest.name}, ${Math.round(hours)} h old`);
      }
    } catch (err) {
      finding("backups", `Backup ${spec}*: could not check: ${(err as Error).message}`);
    }
  }
}

async function main(): Promise<void> {
  if (pm2Index >= 0 && !pm2App) {
    console.error("--pm2 needs an app name");
    process.exit(2);
  }
  await checkNode();
  if (checkOs) await checkUbuntu();
  if (checkDb) await checkDbExtensions();
  if (tlsHosts.length > 0) await checkTls();
  if (backupSpecs.length > 0) await checkBackups();
  if (checkDocker) await checkDockerImages();
  console.log(findings === 0 ? "Runtime security: all clear" : `Runtime security: ${findings} finding(s)`);
  process.exit(strict && findings > 0 ? 1 : 0);
}

void main();
