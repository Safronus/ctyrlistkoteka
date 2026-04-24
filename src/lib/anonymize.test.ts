import { describe, it, expect } from "vitest";
import { anonymize, anonymizeMany } from "./anonymize";
import { ANON_GPS_PRECISION } from "./constants";

describe("anonymize", () => {
  it("passes through non-anonymized finds unchanged", () => {
    const input = {
      id: 1,
      isAnonymized: false,
      notes: "perfectly public note",
      coordinates: { lat: 49.36668, lng: 17.88867 },
    };
    const out = anonymize(input);
    expect(out).toEqual(input);
  });

  it("nulls notes on anonymized finds", () => {
    const out = anonymize({
      id: 1,
      isAnonymized: true,
      notes: "secret: found on Nováks' garden",
      coordinates: { lat: 49.36668, lng: 17.88867 },
    });
    expect(out.notes).toBeNull();
  });

  it("coarsens GPS to ANON_GPS_PRECISION decimals", () => {
    expect(ANON_GPS_PRECISION).toBeGreaterThan(0);
    const out = anonymize({
      id: 1,
      isAnonymized: true,
      notes: null,
      coordinates: { lat: 49.36668, lng: 17.88867 },
    });
    const factor = 10 ** ANON_GPS_PRECISION;
    expect(out.coordinates!.lat).toBe(
      Math.round(49.36668 * factor) / factor,
    );
    expect(out.coordinates!.lng).toBe(
      Math.round(17.88867 * factor) / factor,
    );
  });

  it("keeps null coordinates as null", () => {
    const out = anonymize({
      id: 1,
      isAnonymized: true,
      notes: "x",
      coordinates: null,
    });
    expect(out.coordinates).toBeNull();
  });

  it("anonymizeMany processes an array", () => {
    const arr = [
      { id: 1, isAnonymized: true, notes: "a", coordinates: null },
      { id: 2, isAnonymized: false, notes: "b", coordinates: null },
    ];
    const out = anonymizeMany(arr);
    expect(out[0]!.notes).toBeNull();
    expect(out[1]!.notes).toBe("b");
  });
});
