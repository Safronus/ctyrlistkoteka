import { describe, expect, it } from "vitest";
import { formatGps } from "./gpsFormat";

// Reference point: 49°14'09.870"N 17°40'18.970"E (a real find in Zlín).
const LAT = 49 + 14 / 60 + 9.87 / 3600; // 49.236075
const LNG = 17 + 40 / 60 + 18.97 / 3600; // 17.671936

describe("formatGps", () => {
  it("apple DMS, direction suffix, localised letters", () => {
    expect(formatGps("apple", LAT, LNG, "en")).toBe(
      `49°14'09.9"N 17°40'19.0"E`,
    );
    expect(formatGps("apple", LAT, LNG, "cs")).toBe(
      `49°14'09.9"S 17°40'19.0"V`,
    );
  });

  it("verbose DMS has no stray spaces after ° and '", () => {
    expect(formatGps("verbose", LAT, LNG, "cs")).toBe(
      `S 49°14'09.870" V 17°40'18.970"`,
    );
  });

  it("degrees + decimal minutes, zero-padded degrees", () => {
    // (last minute digit is a floating-point round of 14.1645 → 14.164/165)
    expect(formatGps("ddm", LAT, LNG, "cs")).toMatch(
      /^S 49° 14\.16[45] V 017° 40\.316$/,
    );
    expect(formatGps("ddm", LAT, LNG, "en")).toMatch(
      /^N 49° 14\.16[45] E 017° 40\.316$/,
    );
  });

  it("signed decimal degrees (locale-independent)", () => {
    expect(formatGps("dd", LAT, LNG, "cs")).toBe("49.236075, 17.671936");
  });

  it("UTM zone 33U, plausible easting/northing", () => {
    const utm = formatGps("utm", LAT, LNG);
    expect(utm).toMatch(/^33U \d{6} \d{7}$/);
    const [, e, n] = utm.match(/^33U (\d+) (\d+)$/)!;
    // ~194 km east of zone 33's 15°E central meridian → easting ~694 k.
    expect(Number(e)).toBeGreaterThan(680_000);
    expect(Number(e)).toBeLessThan(710_000);
    expect(Number(n)).toBeGreaterThan(5_450_000);
    expect(Number(n)).toBeLessThan(5_460_000);
  });

  it("localises the southern / western hemispheres for cs", () => {
    expect(formatGps("apple", -12.5, -60.25, "cs")).toContain("J");
    expect(formatGps("apple", -12.5, -60.25, "cs")).toContain("Z");
  });
});
