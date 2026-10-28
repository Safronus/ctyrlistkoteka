import { describe, expect, it } from "vitest";
import {
  assessNode,
  compareVersions,
  isCodenameSupported,
  osCodename,
  parseVersion,
  securityUpgrades,
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
