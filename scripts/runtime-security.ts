/**
 * Pure helpers for scripts/check-runtime-security.ts — no I/O here, so the
 * decisions (is this Node vulnerable? which OS packages wait for a security
 * fix? is this Ubuntu still supported?) are unit-tested in isolation.
 *
 * Dependabot only sees package.json / the lockfile / workflow actions. The
 * Node.js runtime itself and the OS packages under it (nginx, OpenSSL,
 * PostgreSQL) are invisible to it — CVE-2026-111497 "Node2Shell" (2026-10)
 * was a Node runtime bug no `pnpm update` could fix.
 */

/** One entry of https://nodejs.org/dist/index.json (fields we read). */
export interface NodeRelease {
  version: string; // "v24.22.1"
  security: boolean;
}

type Semver = [number, number, number];

export function parseVersion(raw: string): Semver | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
  if (!m) return null;
  const [, major, minor, patch] = m;
  return [Number(major), Number(minor), Number(patch)];
}

export function compareVersions(a: Semver, b: Semver): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export type NodeAssessment =
  | { status: "ok"; current: string; latestInLine: string }
  | {
      status: "vulnerable";
      current: string;
      /** Newest security release of the same major line. */
      latestSecurity: string;
      /** Newest release of the line — the version to upgrade to. */
      latestInLine: string;
    }
  | { status: "unknown"; current: string; reason: string };

/**
 * A Node version is vulnerable when its own major line has a security
 * release newer than it: every security release fixes bugs present in all
 * earlier versions of that line. Only the same major is compared — a newer
 * major is a migration, not a patch.
 */
export function assessNode(
  current: string,
  releases: readonly NodeRelease[],
): NodeAssessment {
  const cur = parseVersion(current);
  if (!cur) return { status: "unknown", current, reason: "unparseable version" };

  let latest: Semver | null = null;
  let latestSecurity: Semver | null = null;
  for (const r of releases) {
    const v = parseVersion(r.version);
    if (!v || v[0] !== cur[0]) continue;
    if (!latest || compareVersions(v, latest) > 0) latest = v;
    if (r.security && (!latestSecurity || compareVersions(v, latestSecurity) > 0)) {
      latestSecurity = v;
    }
  }
  if (!latest) {
    return { status: "unknown", current, reason: `no releases listed for v${cur[0]}` };
  }

  const fmt = (v: Semver) => `v${v.join(".")}`;
  if (latestSecurity && compareVersions(latestSecurity, cur) > 0) {
    return {
      status: "vulnerable",
      current: fmt(cur),
      latestSecurity: fmt(latestSecurity),
      latestInLine: fmt(latest),
    };
  }
  return { status: "ok", current: fmt(cur), latestInLine: fmt(latest) };
}

/**
 * Package names from `apt list --upgradable` whose candidate comes from a
 * `-security` pocket, e.g. `openssl/questing-security 3.5.3-1ubuntu2 amd64
 * [upgradable from: …]`. The "Listing..." header and apt's CLI warning are
 * ignored.
 */
export function securityUpgrades(aptListOutput: string): string[] {
  const names: string[] = [];
  for (const line of aptListOutput.split("\n")) {
    const m = /^([^/\s]+)\/(\S+)\s/.exec(line);
    if (!m) continue;
    const [, name = "", suites = ""] = m;
    if (suites.split(",").some((suite) => suite.endsWith("-security"))) {
      names.push(name);
    }
  }
  return names;
}

/** Is this source (`<label>:<version>/<suite>`) Ubuntu's own archive,
 *  incl. Ubuntu Pro ESM (`UbuntuESM`, `UbuntuESMApps`)? */
function isUbuntuSource(source: string): boolean {
  const label = source.slice(0, source.indexOf(":"));
  return label === "Ubuntu" || label.startsWith("UbuntuESM");
}

/**
 * Package names from `apt-get -s dist-upgrade` whose new version comes ONLY
 * from repositories outside Ubuntu's archive — PGDG, Docker CE, and the like.
 *
 * `securityUpgrades` can't see these: a foreign repo has no `-security`
 * pocket, so its fixes never match there, and they usually aren't in
 * unattended-upgrades' origins either. Any pending upgrade from such a repo
 * is therefore reported — it may well be the security release.
 *
 * Why the simulation and not `apt list --upgradable`: the list shows only
 * the suite, and Docker CE names its suite after the release (`resolute`),
 * indistinguishable from the archive. The simulation prints the origin
 * label of every source, e.g. (captured on 26.04, 2026-10-28)
 *   Inst openssl [3.5.5-1ubuntu3] (3.5.5-1ubuntu3.7 Ubuntu:26.04/resolute-updates, Ubuntu:26.04/resolute-security [arm64])
 *   Inst docker-ce-cli [5:29.9.1-…] (5:29.9.2-… Docker CE:resolute [arm64])
 *   Inst postgresql-client-17 [17.10-…] (17.11-… PostgreSQL for Debian/Ubuntu repository:resolute-pgdg [arm64])
 * Labels may contain spaces and slashes, so sources are split on ", " only.
 */
export function thirdPartyUpgrades(aptGetSimulation: string): string[] {
  const names: string[] = [];
  for (const line of aptGetSimulation.split("\n")) {
    // Inst <name> [<installed>] (<version> <source>, <source> [<arch>])
    const text = line.trimEnd();
    if (!text.startsWith("Inst ") || !text.endsWith("])")) continue;
    const open = text.indexOf(" (");
    const arch = text.lastIndexOf(" [");
    if (open < 0 || arch <= open) continue;
    const name = text.slice("Inst ".length).split(" ")[0] ?? "";
    const versionAndSources = text.slice(open + 2, arch);
    const space = versionAndSources.indexOf(" ");
    if (!name || space < 0) continue; // no source listed — nothing to judge
    const sources = versionAndSources.slice(space + 1);
    if (!sources.split(", ").some(isUbuntuSource)) names.push(name);
  }
  return names;
}

/**
 * Installed packages no configured repository offers any more — from
 * `apt list --installed`, where apt marks them `[installed,local]`, e.g.
 * (captured on 26.04 after the Docker repo was disabled, 2026-10-28)
 *   docker-ce-cli/now 5:29.9.2-1~ubuntu.26.04~resolute arm64 [installed,local]
 *
 * Neither `securityUpgrades` nor `thirdPartyUpgrades` can see these: with
 * no source there is never an upgrade to list, so an orphan reads as
 * "nothing pending" forever. That is how docker-ce sat on the VPS for
 * months — its repo vanished in a release upgrade (do-release-upgrade
 * disables third-party repos) and nothing noticed. Leftovers of an old
 * release (obsolete libs, old kernels) show up here too, and rightly so:
 * they get no fixes either.
 */
export function orphanedPackages(aptListInstalled: string): string[] {
  const names: string[] = [];
  for (const line of aptListInstalled.split("\n")) {
    const open = line.lastIndexOf("[");
    if (open < 0 || !line.trimEnd().endsWith("]")) continue;
    const flags = line.slice(open + 1, line.trimEnd().length - 1).split(",");
    if (!flags.includes("installed") || !flags.includes("local")) continue;
    const name = line.slice(0, line.indexOf("/"));
    if (name) names.push(name);
  }
  return names;
}

/**
 * Unit names from `systemctl list-units --state=failed --plain --no-legend`.
 * Each line starts with the unit name; anything else (an empty output, a
 * stray message) yields nothing. The failed logrotate.service sat unseen
 * from 2026-05-02 to 2026-10-28 — this is what would have caught it.
 */
export function failedUnits(systemctlOutput: string): string[] {
  const units: string[] = [];
  for (const line of systemctlOutput.split("\n")) {
    const name = line.trim().replace(/^[●*]\s*/, "").split(/\s+/)[0] ?? "";
    if (/^[\w@.:\\-]+\.(service|socket|timer|mount|path|target|scope|slice|device|swap|automount)$/.test(name)) {
      units.push(name);
    }
  }
  return units;
}

/** One row of `pg_available_extensions` for an extension the DB has. */
export interface ExtensionRow {
  name: string;
  /** What the installed package provides. */
  default_version: string;
  /** What the database is actually running. */
  installed_version: string;
}

/**
 * Extensions whose version in the database lags the installed package.
 * A package upgrade (apt) does NOT upgrade an extension already created
 * in a database — someone has to run `ALTER EXTENSION … UPDATE` (for
 * PostGIS: `SELECT postgis_extensions_upgrade();`). Found 2026-10-28:
 * PostGIS 3.5.2 in the DB against a 3.5.3 package, months after the apt
 * upgrade.
 */
export function outdatedExtensions(
  rows: readonly ExtensionRow[],
): { name: string; installed: string; available: string }[] {
  return rows
    .filter((r) => r.installed_version !== r.default_version)
    .map((r) => ({ name: r.name, installed: r.installed_version, available: r.default_version }));
}

/** certbot renews at 30 days left — under 21 means renewal is failing. */
export const CERT_WARN_DAYS = 21;

/** Whole days until `validTo` (negative once expired). */
export function certDaysLeft(validTo: Date, now: Date): number {
  return Math.floor((validTo.getTime() - now.getTime()) / 86_400_000);
}

/** Backups run nightly; a weekly check older than this has missed one. */
export const BACKUP_MAX_AGE_HOURS = 36;

/**
 * Newest file in a directory listing whose name starts with `prefix`
 * (`goatcounter-`, `ctyrlistkoteka-`…) — per kind, so one kind still
 * succeeding can't hide another that stopped.
 */
export function newestWithPrefix(
  files: readonly { name: string; mtimeMs: number }[],
  prefix: string,
): { name: string; mtimeMs: number } | null {
  let best: { name: string; mtimeMs: number } | null = null;
  for (const f of files) {
    if (!f.name.startsWith(prefix) || f.name.endsWith(".partial")) continue;
    if (!best || f.mtimeMs > best.mtimeMs) best = f;
  }
  return best;
}

/** `VERSION_CODENAME` from the contents of /etc/os-release. */
export function osCodename(osRelease: string): string | null {
  const m = /^VERSION_CODENAME="?([a-z]+)"?\s*$/m.exec(osRelease);
  return m?.[1] ?? null;
}

/** Is `codename` among the lines printed by `ubuntu-distro-info --supported`? */
export function isCodenameSupported(codename: string, supportedOutput: string): boolean {
  return supportedOutput
    .split("\n")
    .map((l) => l.trim())
    .includes(codename);
}

// ─── Docker images ─────────────────────────────────────────────────────────

/** Where a `docker run` image reference is pulled from. */
export interface ImageRef {
  /** Registry API host, e.g. `registry-1.docker.io`, `ghcr.io`. */
  registry: string;
  /** Repository path on that registry, e.g. `library/redis`. */
  repository: string;
  tag: string;
}

export type ParsedImageRef =
  | { kind: "tag"; ref: ImageRef }
  /** `name@sha256:…` — fixed on purpose; there is no "newer" to compare. */
  | { kind: "pinned" }
  | { kind: "invalid" };

const DOCKER_HUB_API = "registry-1.docker.io";

/**
 * Splits an image reference the way the Docker CLI does: the first path
 * component is a registry only when it looks like a host (has a `.` or `:`,
 * or is `localhost`); otherwise the image is on Docker Hub, where a bare
 * name lives under `library/`. A missing tag means `latest`.
 */
export function parseImageRef(raw: string): ParsedImageRef {
  const ref = raw.trim();
  if (ref.includes("@")) return { kind: "pinned" };
  if (!ref || /\s/.test(ref)) return { kind: "invalid" };

  const slash = ref.indexOf("/");
  const first = slash < 0 ? "" : ref.slice(0, slash);
  const isHost = first.includes(".") || first.includes(":") || first === "localhost";
  const registry = isHost ? first : DOCKER_HUB_API;
  let path = isHost ? ref.slice(slash + 1) : ref;

  // The tag is after the last ":" of the LAST path component (a registry
  // port has its own ":" but sits before the first "/").
  const lastSlash = path.lastIndexOf("/");
  const colon = path.lastIndexOf(":");
  let tag = "latest";
  if (colon > lastSlash) {
    tag = path.slice(colon + 1);
    path = path.slice(0, colon);
  }
  if (!path || !tag) return { kind: "invalid" };
  if (registry === DOCKER_HUB_API && !path.includes("/")) path = `library/${path}`;
  return { kind: "tag", ref: { registry, repository: path.toLowerCase(), tag } };
}

/** `WWW-Authenticate: Bearer realm="…",service="…",scope="…"` → its params. */
export function parseBearerChallenge(
  header: string,
): { realm: string; service?: string; scope?: string } | null {
  const trimmed = header.trim();
  if (!/^bearer\s/i.test(trimmed)) return null;
  const params = new Map<string, string>();
  for (const part of trimmed.slice("bearer".length).split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim().replace(/^"|"$/g, "");
    params.set(key, value);
  }
  const realm = params.get("realm");
  // The token endpoint comes from the registry's answer — only ever follow
  // it over https.
  if (!realm?.startsWith("https://")) return null;
  return { realm, service: params.get("service"), scope: params.get("scope") };
}

/**
 * Does the image a container runs match what its tag points to in the
 * registry now? `repoDigests` is `docker image inspect` → `.RepoDigests`
 * (`name@sha256:…`) of the image the CONTAINER uses — so a fresh `docker
 * pull` without recreating the container still reads as outdated, which it
 * is.
 */
export function isImageCurrent(repoDigests: readonly string[], remoteDigest: string): boolean {
  return repoDigests.some((d) => d.slice(d.indexOf("@") + 1) === remoteDigest);
}

// ─── Output ────────────────────────────────────────────────────────────────

/** What a result is about — the only thing a public log gets to see. */
export type CheckCategory =
  | "node"
  | "pm2-node"
  | "os-release"
  | "apt-security"
  | "apt-foreign"
  | "apt-orphaned"
  | "systemd-failed"
  | "db-extensions"
  | "tls"
  | "backups"
  | "docker";

/**
 * One output line for a check result.
 *
 * The repo is public, and so are its GitHub Actions logs: a line such as
 * "openssl, libssl3t64 pending" or "Ubuntu … no longer supported" there is
 * a list of what the server has NOT patched, readable by anyone. So inside
 * Actions a line names only its category and points at the VPS for the
 * details; everywhere else (a shell on the VPS, a laptop) it says it all.
 */
export function formatResult(
  kind: "ok" | "finding",
  category: CheckCategory,
  message: string,
  opts: { inActions: boolean; strict: boolean },
): string {
  if (kind === "ok") {
    return opts.inActions ? `[ok] ${category}` : `[ok] ${message}`;
  }
  const level = opts.strict ? "error" : "warning";
  return opts.inActions
    ? `::${level}::Runtime security finding [${category}] — details only on the VPS: run the check-runtime-security.ts command from runtime-security.yml there`
    : `[${level}] ${message}`;
}
