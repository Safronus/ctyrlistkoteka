import { describe, expect, it } from "vitest";

import { cityFromCadastralArea, isLocationGone } from "./locationCode";

describe("isLocationGone (v2: is_cancelled is the sole signal)", () => {
  it("true only when is_cancelled is true — the code is not consulted", () => {
    expect(isLocationGone("CZ_ZLÍN_NADSTRÁNĚMI_002", true)).toBe(true);
    expect(isLocationGone("CZ_RATIBOŘ_DOMA", false)).toBe(false);
  });

  it("ignores the retired v1 NEEXISTUJE- code prefix", () => {
    // Post-migration no code carries the prefix (sync rewrote them clean +
    // set is_cancelled). Gone-ness comes only from the flag now.
    expect(isLocationGone("NEEXISTUJE-FOO", false)).toBe(false);
    expect(isLocationGone("NEEXISTUJE-FOO", true)).toBe(true);
  });

  it("treats null/undefined is_cancelled as not-cancelled", () => {
    expect(isLocationGone("FOO", null)).toBe(false);
    expect(isLocationGone("FOO", undefined)).toBe(false);
  });
});

describe("cityFromCadastralArea", () => {
  it("returns the cadastralArea as-is (v2 = plain city)", () => {
    expect(cityFromCadastralArea("Zlín")).toBe("Zlín");
    expect(cityFromCadastralArea("Brno")).toBe("Brno");
  });

  it("coerces null/undefined to an empty string", () => {
    expect(cityFromCadastralArea(null)).toBe("");
    expect(cityFromCadastralArea(undefined)).toBe("");
  });
});
