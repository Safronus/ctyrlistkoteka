import { describe, expect, it } from "vitest";
import {
  assessNode,
  certDaysLeft,
  compareVersions,
  formatResult,
  orphanedPackages,
  outdatedExtensions,
  isCodenameSupported,
  isImageCurrent,
  newestWithPrefix,
  osCodename,
  parseBearerChallenge,
  parseImageRef,
  parseVersion,
  securityUpgrades,
  thirdPartyUpgrades,
  type NodeRelease,
} from "./runtime-security";

// Shape of nodejs.org/dist/index.json around the Node2Shell release.
const RELEASES: NodeRelease[] = [
  { version: "v26.12.1", security: true },
  { version: "v24.23.0", security: false },
  { version: "v24.22.1", security: true },
  { version: "v24.22.0", security: false },
  { version: "v24.18.0", security: false },
  { version: "v24.17.2", security: true },
  { version: "v22.23.4", security: true },
];

describe("parseVersion / compareVersions", () => {
  it("parses with and without the v prefix", () => {
    expect(parseVersion("v24.22.1")).toEqual([24, 22, 1]);
    expect(parseVersion("24.22.1\n")).toEqual([24, 22, 1]);
  });

  it("rejects anything that is not plain x.y.z", () => {
    expect(parseVersion("v24.22")).toBeNull();
    expect(parseVersion("v25.0.0-rc.1")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });

  it("compares numerically, not lexically", () => {
    expect(compareVersions([24, 9, 0], [24, 18, 0])).toBeLessThan(0);
    expect(compareVersions([24, 22, 1], [24, 22, 1])).toBe(0);
  });
});

describe("assessNode", () => {
  it("flags a version older than the line's newest security release", () => {
    expect(assessNode("v24.18.0", RELEASES)).toEqual({
      status: "vulnerable",
      current: "v24.18.0",
      latestSecurity: "v24.22.1",
      latestInLine: "v24.23.0",
    });
  });

  it("accepts the security release itself", () => {
    expect(assessNode("v24.22.1", RELEASES)).toEqual({
      status: "ok",
      current: "v24.22.1",
      latestInLine: "v24.23.0",
    });
  });

  it("accepts a newer non-security release", () => {
    expect(assessNode("v24.23.0", RELEASES).status).toBe("ok");
  });

  it("only compares within the same major line", () => {
    // v26's security release must not mark v22.23.4 vulnerable.
    expect(assessNode("v22.23.4", RELEASES).status).toBe("ok");
  });

  it("is unknown for a line missing from the index", () => {
    expect(assessNode("v20.20.2", RELEASES)).toMatchObject({ status: "unknown" });
  });

  it("is unknown for garbage input", () => {
    expect(assessNode("node", RELEASES)).toMatchObject({ status: "unknown" });
  });
});

describe("securityUpgrades", () => {
  it("picks only packages from a -security pocket", () => {
    const out = [
      "",
      "WARNING: apt does not have a stable CLI interface. Use with caution in scripts.",
      "",
      "Listing...",
      "nginx/noble-updates 1.24.0-2ubuntu7.6 amd64 [upgradable from: 1.24.0-2ubuntu7.5]",
      "openssl/noble-updates,noble-security 3.0.13-0ubuntu3.7 amd64 [upgradable from: 3.0.13-0ubuntu3.6]",
      "libssl3t64/noble-security 3.0.13-0ubuntu3.7 amd64 [upgradable from: 3.0.13-0ubuntu3.6]",
    ].join("\n");
    expect(securityUpgrades(out)).toEqual(["openssl", "libssl3t64"]);
  });

  it("returns nothing for an up-to-date system", () => {
    expect(securityUpgrades("Listing...\n")).toEqual([]);
  });
});

describe("osCodename / isCodenameSupported", () => {
  const osRelease = 'PRETTY_NAME="Ubuntu 25.10"\nVERSION_CODENAME=questing\nID=ubuntu\n';

  it("reads the codename, quoted or not", () => {
    expect(osCodename(osRelease)).toBe("questing");
    expect(osCodename('VERSION_CODENAME="resolute"\n')).toBe("resolute");
    expect(osCodename("ID=ubuntu\n")).toBeNull();
  });

  it("matches whole lines of ubuntu-distro-info --supported", () => {
    const supported = "jammy\nnoble\nresolute\n";
    expect(isCodenameSupported("noble", supported)).toBe(true);
    expect(isCodenameSupported("questing", supported)).toBe(false);
    expect(isCodenameSupported("nob", supported)).toBe(false);
  });
});

describe("thirdPartyUpgrades", () => {
  // Real `apt-get -s dist-upgrade` lines, captured on Ubuntu 26.04 with the
  // PGDG and Docker CE repos added (2026-10-28).
  const sim = [
    "NOTE: This is only a simulation!",
    "      apt-get needs root privileges for real execution.",
    "Inst libssl3t64 [3.5.5-1ubuntu3] (3.5.5-1ubuntu3.7 Ubuntu:26.04/resolute-updates, Ubuntu:26.04/resolute-security [arm64])",
    "Inst docker-ce-cli [5:29.9.1-1~ubuntu.26.04~resolute] (5:29.9.2-1~ubuntu.26.04~resolute Docker CE:resolute [arm64])",
    "Inst postgresql-client-17 [17.10-1.pgdg26.04+1] (17.11-1.pgdg26.04+2 PostgreSQL for Debian/Ubuntu repository:resolute-pgdg [arm64])",
    "Conf libssl3t64 (3.5.5-1ubuntu3.7 Ubuntu:26.04/resolute-updates, Ubuntu:26.04/resolute-security [arm64])",
  ].join("\n");

  it("reports packages whose new version comes only from a foreign repo", () => {
    expect(thirdPartyUpgrades(sim)).toEqual(["docker-ce-cli", "postgresql-client-17"]);
  });

  it("counts a package as Ubuntu's when any of its sources is the archive or ESM", () => {
    const mixed = [
      "Inst libpq5 [17.10-1] (17.11-1 PostgreSQL for Debian/Ubuntu repository:resolute-pgdg, Ubuntu:26.04/resolute-updates [amd64])",
      "Inst libfoo [1.0] (1.0+esm1 UbuntuESMApps:26.04/resolute-apps-security [amd64])",
    ].join("\n");
    expect(thirdPartyUpgrades(mixed)).toEqual([]);
  });

  it("reads a new dependency (no installed version) and ignores everything else", () => {
    expect(
      thirdPartyUpgrades("Inst containerd.io (2.2.2-1 Docker CE:resolute [amd64])\nRemv foo [1.0]\n"),
    ).toEqual(["containerd.io"]);
    expect(thirdPartyUpgrades("NOTE: This is only a simulation!\n")).toEqual([]);
    expect(thirdPartyUpgrades("Inst odd [1.0] (1.1 [amd64])")).toEqual([]);
  });
});

describe("parseImageRef", () => {
  it("puts bare and user names on Docker Hub, bare ones under library/", () => {
    expect(parseImageRef("redis:7-alpine")).toEqual({
      kind: "tag",
      ref: { registry: "registry-1.docker.io", repository: "library/redis", tag: "7-alpine" },
    });
    expect(parseImageRef("postgis/postgis:16-3.4")).toEqual({
      kind: "tag",
      ref: { registry: "registry-1.docker.io", repository: "postgis/postgis", tag: "16-3.4" },
    });
  });

  it("defaults the tag to latest and recognises a registry host, incl. one with a port", () => {
    expect(parseImageRef("rustdesk/rustdesk-server")).toMatchObject({ ref: { tag: "latest" } });
    expect(parseImageRef("ghcr.io/arp242/goatcounter:2.6")).toEqual({
      kind: "tag",
      ref: { registry: "ghcr.io", repository: "arp242/goatcounter", tag: "2.6" },
    });
    expect(parseImageRef("localhost:5000/team/app")).toEqual({
      kind: "tag",
      ref: { registry: "localhost:5000", repository: "team/app", tag: "latest" },
    });
  });

  it("leaves digest-pinned references alone and rejects junk", () => {
    expect(parseImageRef("redis@sha256:7aec734b")).toEqual({ kind: "pinned" });
    expect(parseImageRef("")).toEqual({ kind: "invalid" });
    expect(parseImageRef("redis:")).toEqual({ kind: "invalid" });
  });
});

describe("parseBearerChallenge", () => {
  it("reads Docker Hub's challenge (captured 2026-10-28)", () => {
    expect(
      parseBearerChallenge(
        'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/redis:pull"',
      ),
    ).toEqual({
      realm: "https://auth.docker.io/token",
      service: "registry.docker.io",
      scope: "repository:library/redis:pull",
    });
  });

  it("refuses a non-bearer challenge or a token endpoint that isn't https", () => {
    expect(parseBearerChallenge('Basic realm="x"')).toBeNull();
    expect(parseBearerChallenge('Bearer realm="http://evil.example/token"')).toBeNull();
  });
});

describe("isImageCurrent", () => {
  const local = ["redis@sha256:7aec734b2bb298a1d769fd8729f13b8514a41bf90fcdd1f38ec52267fbaa8ee6"];

  it("matches on the digest, whatever the name prefix", () => {
    expect(
      isImageCurrent(local, "sha256:7aec734b2bb298a1d769fd8729f13b8514a41bf90fcdd1f38ec52267fbaa8ee6"),
    ).toBe(true);
  });

  it("is outdated when the tag now points elsewhere, or nothing was pulled by tag", () => {
    expect(
      isImageCurrent(local, "sha256:6ba19c50b56777f5c11c58eff8ddb69d0d5f27ba131cffb63f180ccfd43c66af"),
    ).toBe(false);
    expect(isImageCurrent([], "sha256:6ba19c50")).toBe(false);
  });
});

describe("formatResult", () => {
  const detail = "2 apt security upgrade(s) pending: openssl, libssl3t64";

  it("keeps a public Actions log to the category — no package names, versions or OS state", () => {
    const line = formatResult("finding", "apt-security", detail, { inActions: true, strict: true });
    expect(line).toMatch(/^::error::Runtime security finding \[apt-security\]/);
    expect(line).not.toContain("openssl");
    expect(formatResult("ok", "node", "Node.js v24.22.1 (script runtime)", { inActions: true, strict: false }))
      .toBe("[ok] node");
  });

  it("warns instead of erroring without --strict (the deploy)", () => {
    expect(formatResult("finding", "os-release", "x", { inActions: true, strict: false }))
      .toMatch(/^::warning::/);
  });

  it("says everything outside Actions (a shell on the VPS)", () => {
    expect(formatResult("finding", "apt-security", detail, { inActions: false, strict: true }))
      .toBe(`[error] ${detail}`);
    expect(formatResult("ok", "node", "Node.js v24.22.1", { inActions: false, strict: false }))
      .toBe("[ok] Node.js v24.22.1");
  });
});

describe("orphanedPackages", () => {
  // Real `apt list --installed` lines: Ubuntu 26.04, Docker repo disabled
  // afterwards (2026-10-28) — the state the VPS's docker-ce was found in.
  const out = [
    "Listing...",
    "docker-ce-cli/now 5:29.9.2-1~ubuntu.26.04~resolute arm64 [installed,local]",
    "openssl/resolute-updates,resolute-security,now 3.5.5-1ubuntu3.7 arm64 [installed,automatic]",
    "libfoo1/now 1.2-3 amd64 [installed,auto-removable,local]",
    "nginx/resolute,now 1.28.3-2ubuntu1 amd64 [installed]",
  ].join("\n");

  it("lists installed packages no repository offers", () => {
    expect(orphanedPackages(out)).toEqual(["docker-ce-cli", "libfoo1"]);
  });

  it("is quiet when every package has a source", () => {
    expect(orphanedPackages("Listing...\nnginx/resolute,now 1.28.3 amd64 [installed]\n")).toEqual([]);
  });
});

describe("outdatedExtensions", () => {
  it("flags an extension the DB runs older than its package (the PostGIS case)", () => {
    expect(
      outdatedExtensions([
        { name: "pg_trgm", default_version: "1.6", installed_version: "1.6" },
        { name: "plpgsql", default_version: "1.0", installed_version: "1.0" },
        { name: "postgis", default_version: "3.5.3", installed_version: "3.5.2" },
      ]),
    ).toEqual([{ name: "postgis", installed: "3.5.2", available: "3.5.3" }]);
  });

  it("is quiet when every extension is current", () => {
    expect(outdatedExtensions([{ name: "postgis", default_version: "3.5.3", installed_version: "3.5.3" }])).toEqual([]);
  });
});

describe("certDaysLeft", () => {
  it("counts whole days, negative once expired", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    expect(certDaysLeft(new Date("2026-12-27T12:00:00Z"), now)).toBe(60);
    expect(certDaysLeft(new Date("2026-11-08T11:00:00Z"), now)).toBe(10);
    expect(certDaysLeft(new Date("2026-10-27T12:00:00Z"), now)).toBe(-1);
  });
});

describe("newestWithPrefix", () => {
  const files = [
    { name: "goatcounter-2026-10-27_0305.sqlite3.gz", mtimeMs: 100 },
    { name: "goatcounter-2026-10-28_0305.sqlite3.gz", mtimeMs: 200 },
    { name: "goatcounter-2026-10-29_0305.sqlite3.partial", mtimeMs: 300 },
    { name: "rustdesk-keys-2026-10-20_0305.tar.gz", mtimeMs: 50 },
  ];

  it("takes the newest finished file of that kind only", () => {
    expect(newestWithPrefix(files, "goatcounter-")?.name).toBe("goatcounter-2026-10-28_0305.sqlite3.gz");
    // An old rustdesk backup is not rescued by a fresh goatcounter one.
    expect(newestWithPrefix(files, "rustdesk-keys-")?.mtimeMs).toBe(50);
  });

  it("is null when there is none", () => {
    expect(newestWithPrefix(files, "ctyrlistkoteka-")).toBeNull();
  });
});
