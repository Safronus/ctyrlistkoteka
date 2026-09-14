import { describe, expect, it } from "vitest";
import {
  casqbCampaignSlug,
  casqbDestination,
  parseCasqbTargetUrl,
} from "./casqbTarget";

describe("parseCasqbTargetUrl", () => {
  it("takes an https URL and normalises it", () => {
    expect(parseCasqbTargetUrl("  https://casqb.org ")).toEqual({
      ok: true,
      url: "https://casqb.org/",
    });
    expect(parseCasqbTargetUrl("https://casqb.org/program?x=1")).toEqual({
      ok: true,
      url: "https://casqb.org/program?x=1",
    });
  });

  it("refuses what a printed code must never carry", () => {
    for (const bad of [
      "",
      "casqb.org",
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- the case under test
      "http://casqb.org/",
      "https://user:pw@casqb.org/",
      "https://localhost/",
      "javascript:alert(1)",
      "https://ctyrlistkoteka.cz/go/abc123",
      `https://casqb.org/${"a".repeat(2100)}`,
    ]) {
      expect(parseCasqbTargetUrl(bad).ok, bad).toBe(false);
    }
  });
});

describe("casqbCampaignSlug", () => {
  it("flattens a Czech label to something analytics shows intact", () => {
    expect(casqbCampaignSlug("Vizitka – konference jaro 2027")).toBe(
      "vizitka-konference-jaro-2027",
    );
    expect(casqbCampaignSlug("Roll-up – vstup do sálu")).toBe("roll-up-vstup-do-salu");
    expect(casqbCampaignSlug("   ")).toBe("qr");
    expect(casqbCampaignSlug("x".repeat(80))).toHaveLength(60);
  });
});

describe("casqbDestination", () => {
  it("tags the visit", () => {
    const u = casqbDestination("https://casqb.org/", "Vizitka");
    expect(u.toString()).toBe(
      "https://casqb.org/?utm_source=qr&utm_medium=casqb&utm_campaign=vizitka",
    );
  });

  it("keeps the owner's own tags and other params", () => {
    const u = casqbDestination(
      "https://casqb.org/p?ref=1&utm_campaign=jaro",
      "Vizitka",
    );
    expect(u.searchParams.get("ref")).toBe("1");
    expect(u.searchParams.get("utm_campaign")).toBe("jaro");
    expect(u.searchParams.get("utm_source")).toBe("qr");
  });
});
