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
