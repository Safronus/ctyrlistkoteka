import { beforeEach, describe, expect, it } from "vitest";
import {
  CREW_TOKEN_RE,
  crewCookieName,
  crewCookieOk,
  crewCookieValue,
  crewPasswordOk,
  newCrewToken,
  rateLimitCrewUnlock,
  resetCrewUnlockLimits,
} from "./crewMap";

describe("crew map token", () => {
  it("mints tokens the route's own pattern accepts", () => {
    for (let i = 0; i < 50; i++) {
      expect(newCrewToken()).toMatch(CREW_TOKEN_RE);
    }
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 200 }, () => newCrewToken()));
    expect(seen.size).toBe(200);
  });

  it("rejects the shapes the page must never look up", () => {
    for (const bad of ["", "short", "../../etc/passwd", "a".repeat(65), "tok en"]) {
      expect(CREW_TOKEN_RE.test(bad)).toBe(false);
    }
  });
});

describe("crew map cookie", () => {
  // Deliberately readable rather than a realistic 18-byte token: a
  // base64-looking blob in a test file is indistinguishable from a leaked
  // key, and gitleaks rightly said so. The pattern is what matters here,
  // not the entropy.
  const token = "crew-map-test-token-not-a-secret";

  it("accepts the value it minted", () => {
    const v = crewCookieValue(token, "ctyrlistek2026");
    expect(crewCookieOk(v, token, "ctyrlistek2026")).toBe(true);
  });

  it("dies when the password changes — the revoke path", () => {
    const v = crewCookieValue(token, "ctyrlistek2026");
    expect(crewCookieOk(v, token, "neco-jineho")).toBe(false);
  });

  it("is not transferable between areas", () => {
    const v = crewCookieValue(token, "spolecne-heslo");
    expect(crewCookieOk(v, "crew-map-other-area-token-fake", "spolecne-heslo")).toBe(
      false,
    );
  });

  it("rejects a missing or malformed cookie instead of throwing", () => {
    expect(crewCookieOk(undefined, token, "x")).toBe(false);
    expect(crewCookieOk("", token, "x")).toBe(false);
    // timingSafeEqual throws on unequal lengths — the guard must catch it.
    expect(crewCookieOk("deadbeef", token, "x")).toBe(false);
  });

  it("names the cookie per area, not per site", () => {
    expect(crewCookieName(token)).not.toBe(crewCookieName("crew-map-second-area-token-fake"));
    expect(crewCookieName(token)).toBe(crewCookieName(token));
    // The token itself must not be readable off the cookie name.
    expect(crewCookieName(token)).not.toContain(token);
  });
});

describe("crew map password compare", () => {
  it("matches only the exact string", () => {
    expect(crewPasswordOk("Trávník1", "Trávník1")).toBe(true);
    expect(crewPasswordOk("travnik1", "Trávník1")).toBe(false);
    expect(crewPasswordOk("Trávník1 ", "Trávník1")).toBe(false);
  });

  it("compares different lengths without throwing", () => {
    expect(crewPasswordOk("a", "much-longer-password")).toBe(false);
  });
});

describe("crew unlock throttle", () => {
  beforeEach(() => resetCrewUnlockLimits());

  it("allows ten tries, then stops", () => {
    for (let i = 0; i < 10; i++) {
      expect(rateLimitCrewUnlock("ip|token", 1000)).toBe(true);
    }
    expect(rateLimitCrewUnlock("ip|token", 1000)).toBe(false);
  });

  it("counts each area separately", () => {
    for (let i = 0; i < 10; i++) rateLimitCrewUnlock("ip|a", 1000);
    expect(rateLimitCrewUnlock("ip|a", 1000)).toBe(false);
    expect(rateLimitCrewUnlock("ip|b", 1000)).toBe(true);
  });

  it("reopens after the window", () => {
    for (let i = 0; i < 10; i++) rateLimitCrewUnlock("ip|token", 1000);
    expect(rateLimitCrewUnlock("ip|token", 1000)).toBe(false);
    expect(rateLimitCrewUnlock("ip|token", 1000 + 10 * 60_000 + 1)).toBe(true);
  });
});
