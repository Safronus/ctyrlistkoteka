import { describe, it, expect } from "vitest";
import { formatAreaM2 } from "./format";

describe("formatAreaM2 — sub-square-metre areas", () => {
  it("shows two decimals for a tiny-radius location (15 cm → ~0.07 m²)", () => {
    // π·0.15² ≈ 0.0707 m² — must NOT round to a misleading "0 m²".
    expect(formatAreaM2(Math.PI * 0.15 ** 2)).toBe("0,07 m²");
  });

  it("floors the absurdly small to a readable threshold", () => {
    expect(formatAreaM2(0.003)).toBe("<0,01 m²");
  });

  it("keeps whole-number metres at / above 1 m²", () => {
    expect(formatAreaM2(1)).toBe("1 m²");
    expect(formatAreaM2(6.4)).toBe("6 m²");
  });

  it("switches to hectares / km² for large areas", () => {
    expect(formatAreaM2(15_000)).toBe("1,5 ha");
    expect(formatAreaM2(2_000_000)).toBe("2 km²");
  });
});
