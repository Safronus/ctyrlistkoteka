import { describe, expect, it } from "vitest";
import { parseGps, formatGpsDecimal } from "./parseGps";

/** Zlín-ish reference point used across the cases. */
const LAT = 49.366639;
const LNG = 17.888722;

function near(
  got: { lat: number; lng: number } | null,
  lat: number,
  lng: number,
  tol = 0.0005,
) {
  expect(got).not.toBeNull();
  expect(Math.abs(got!.lat - lat)).toBeLessThan(tol);
  expect(Math.abs(got!.lng - lng)).toBeLessThan(tol);
}

describe("parseGps", () => {
  it("reads plain decimal degrees", () => {
    near(parseGps("49.366639, 17.888722"), LAT, LNG);
    near(parseGps("49.366639 17.888722"), LAT, LNG);
    near(parseGps("49.366639;17.888722"), LAT, LNG);
  });

  it("reads DMS with English hemispheres", () => {
    near(parseGps(`49°21'59.9"N 17°53'19.4"E`), LAT, LNG);
    near(parseGps(`49°21'59.9"N, 17°53'19.4"E`), LAT, LNG);
  });

  it("reads DMS with Czech hemispheres (S = sever)", () => {
    // This is what the site itself prints — S must come out NORTH here.
    near(parseGps(`49°21'59.9"S 17°53'19.4"V`), LAT, LNG);
  });

  it("keeps English S as south", () => {
    const got = parseGps(`49°21'59.9"S 17°53'19.4"E`);
    expect(got).not.toBeNull();
    expect(got!.lat).toBeLessThan(0);
  });

  it("reads degrees + decimal minutes with leading letters", () => {
    near(parseGps(`N 49° 21.998' E 17° 53.323'`), LAT, LNG);
  });

  it("applies western / southern signs", () => {
    near(parseGps(`51°28'40.1"N 0°00'05.3"W`), 51.477806, -0.001472);
    near(parseGps("-33.856778, 151.215306"), -33.856778, 151.215306);
  });

  it("accepts a decimal comma when the pair is separated otherwise", () => {
    near(parseGps("49,366639; 17,888722"), LAT, LNG);
  });

  it("pulls coordinates out of pasted map URLs", () => {
    near(
      parseGps("https://mapy.cz/zakladni?x=17.888722&y=49.366639&z=17"),
      LAT,
      LNG,
    );
    near(
      parseGps("https://www.google.com/maps/@49.366639,17.888722,17z"),
      LAT,
      LNG,
    );
  });

  it("rejects junk and out-of-range values", () => {
    expect(parseGps("")).toBeNull();
    expect(parseGps("kdesi u lesa")).toBeNull();
    expect(parseGps("123.4, 17.8")).toBeNull(); // lat > 90
    expect(parseGps("49.36, 200.1")).toBeNull(); // lng > 180
    expect(parseGps("49°70'00.0\"N 17°00'00.0\"E")).toBeNull(); // 70 minutes
  });

  it("round-trips through the canonical decimal form", () => {
    const canonical = formatGpsDecimal(LAT, LNG);
    expect(canonical).toBe("49.366639, 17.888722");
    near(parseGps(canonical), LAT, LNG);
  });
});
