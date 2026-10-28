/**
 * Runtime security check — the part Dependabot can't see.
 *
 *   pnpm tsx scripts/check-runtime-security.ts [--strict] [--os] [--pm2 <app>]
 *
 * Checks:
 *   • Node.js — the binary running this script (= the nvm default the deploy
 *     builds with) and, with `--pm2 <app>`, the binaries the PM2 workers
 *     actually run. Those can differ: dump.pm2 pins `exec_interpreter` to an
 *     absolute path and `pm2 reload` keeps it (docs/deployment.md). Each is
 *     compared with the newest security release of its major line from
 *     nodejs.org/dist/index.json.
 *   • `--os` (Linux) — Ubuntu release still supported (`ubuntu-distro-info
 *     --supported`) and no pending upgrades from a `-security` pocket.
 *     Both matter: an EOL release gets no new security packages, so "no
 *     pending security upgrades" alone would read as green forever.
 *
 * Exit code: 0 by default (findings are printed as GitHub `::warning::`
 * annotations — used by the deploy, which must never fail on this); with
 * `--strict` 1 on any finding or check that could not run (the weekly
 * workflow, so a failed run e-mails the owner).
 *
 * The only outbound request is a GET of nodejs.org/dist/index.json from the
 * VPS runner — no project data leaves the machine (CLAUDE.md §9).
 */

import { execFile } from "node:child_process";
import { readFile, readlink } from "node:fs/promises";
import { promisify } from "node:util";
import {
  assessNode,
  isCodenameSupported,
  osCodename,
  securityUpgrades,
  type NodeRelease,
} from "./runtime-security";

const run = promisify(execFile);

const NODE_INDEX_URL = "https://nodejs.org/dist/index.json";
const FETCH_TIMEOUT_MS = 15_000;
const EXEC_TIMEOUT_MS = 30_000;

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const checkOs = args.includes("--os");
const pm2Index = args.indexOf("--pm2");
const pm2App = pm2Index >= 0 ? args[pm2Index + 1] : undefined;
const inActions = process.env.GITHUB_ACTIONS === "true";

let findings = 0;

function finding(message: string): void {
  findings++;
  const level = strict ? "error" : "warning";
  console.log(inActions ? `::${level}::${message}` : `[${level}] ${message}`);
}

function ok(message: string): void {
  console.log(`[ok] ${message}`);
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
    finding(`Node.js check could not run: ${NODE_INDEX_URL}: ${(err as Error).message}`);
    return;
  }

  const versions = new Map<string, string>([["script runtime", process.version]]);
  if (pm2App) {
    // A failure here must not hide the result for the script runtime.
    try {
      for (const [label, v] of await pm2NodeVersions(pm2App)) versions.set(label, v);
    } catch (err) {
      finding(`PM2 worker Node.js check could not run: ${(err as Error).message}`);
    }
  }

  for (const [label, version] of versions) {
    const a = assessNode(version, releases);
    if (a.status === "ok") {
      ok(`Node.js ${a.current} (${label}) — newest in line ${a.latestInLine}`);
    } else if (a.status === "vulnerable") {
      finding(
        `Node.js ${a.current} (${label}) is older than security release ${a.latestSecurity} — upgrade to ${a.latestInLine} (docs/deployment.md, "Upgrade Node.js")`,
      );
    } else {
      finding(`Node.js ${a.current} (${label}) could not be assessed: ${a.reason}`);
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
      ok(`Ubuntu "${codename}" is a supported release`);
    } else {
      finding(
        `Ubuntu "${codename}" is no longer supported — it receives no security updates; upgrade the release`,
      );
    }
  } catch (err) {
    finding(`Ubuntu support check could not run: ${(err as Error).message}`);
  }

  try {
    // Reads the local package lists only (no sudo, no network); they are as
    // fresh as the last `apt update` / apt-daily timer run.
    const { stdout } = await run("apt", ["list", "--upgradable"], {
      timeout: EXEC_TIMEOUT_MS,
    });
    const pending = securityUpgrades(stdout);
    if (pending.length === 0) {
      ok("No pending security upgrades from apt");
    } else {
      finding(`${pending.length} apt security upgrade(s) pending: ${pending.join(", ")}`);
    }
  } catch (err) {
    finding(`apt security check could not run: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  if (pm2Index >= 0 && !pm2App) {
    console.error("--pm2 needs an app name");
    process.exit(2);
  }
  await checkNode();
  if (checkOs) await checkUbuntu();
  console.log(findings === 0 ? "Runtime security: all clear" : `Runtime security: ${findings} finding(s)`);
  process.exit(strict && findings > 0 ? 1 : 0);
}

void main();
