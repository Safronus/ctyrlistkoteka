import { describe, expect, it } from "vitest";

import { isFormerLocation, isLocationGone } from "./locationCode";

describe("isFormerLocation (v1 signal)", () => {
  it("is true only for the NEEXISTUJE- prefix", () => {
    expect(isFormerLocation("NEEXISTUJE-ZLÍN_POLE001")).toBe(true);
    expect(isFormerLocation("ZLÍN_POLE001")).toBe(false);
  });

  it("is false for null/undefined", () => {
    expect(isFormerLocation(null)).toBe(false);
    expect(isFormerLocation(undefined)).toBe(false);
  });
});

describe("isLocationGone (v1 + v2 combined)", () => {
  it("v1: true from the NEEXISTUJE- prefix even when is_cancelled is false", () => {
    // A v1 location never sets is_cancelled (schema default false); the
    // prefix is its only "gone" signal and must still win.
    expect(isLocationGone("NEEXISTUJE-ZLÍN_POLE001", false)).toBe(true);
  });

  it("v2: true from is_cancelled even without the prefix", () => {
    // A v2 gone location keeps a normal code (no NEEXISTUJE- prefix) — the
    // flag is the only signal.
    expect(isLocationGone("CZ_ZLÍN_JIŽNÍSVAHY_NADSTRÁNĚMI_002", true)).toBe(
      true,
    );
  });

  it("active location: false when neither signal is set", () => {
    expect(isLocationGone("CZ_RATIBOŘ_DOMA", false)).toBe(false);
  });

  it("either signal alone is enough (OR, not AND)", () => {
    expect(isLocationGone("NEEXISTUJE-FOO", true)).toBe(true);
    expect(isLocationGone("FOO", true)).toBe(true);
    expect(isLocationGone("NEEXISTUJE-FOO", false)).toBe(true);
    expect(isLocationGone("FOO", false)).toBe(false);
  });

  it("treats null/undefined is_cancelled as not-cancelled", () => {
    expect(isLocationGone("FOO", null)).toBe(false);
    expect(isLocationGone("FOO", undefined)).toBe(false);
    // …but the prefix still wins regardless of a nullish flag.
    expect(isLocationGone("NEEXISTUJE-FOO", null)).toBe(true);
  });
});
