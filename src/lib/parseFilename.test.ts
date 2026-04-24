import { describe, it, expect } from "vitest";
import { FindState } from "@prisma/client";
import { parseFindFilename, parseMapFilename } from "./parseFilename";
import { splitLocationCode, toAsciiCode } from "./locationCode";

describe("parseFindFilename — real format (+ separators, diacritics)", () => {
  it("parses the canonical example from docs/filename-convention.md", () => {
    const r = parseFindFilename(
      "16230+00031+RATIBOŘ_POLE001f+NORMÁLNÍ+NE+BezPoznámky.HEIC",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      findId: 16230,
      mapNumber: 31,
      locationCode: "RATIBOŘ_POLE001f",
      state: FindState.NORMAL,
      isAnonymized: false,
      hasNote: false,
      note: null,
      extension: "HEIC",
    });
  });

  it("captures a real note (not BezPoznámky)", () => {
    const r = parseFindFilename(
      "156+00010+PRAHA_PARK012b+NORMÁLNÍ+NE+Nalezeno v Irsku v Dublinu.HEIC",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.hasNote).toBe(true);
    expect(r.value.note).toBe("Nalezeno v Irsku v Dublinu");
  });

  it("accepts anonymization flag ANO", () => {
    const r = parseFindFilename(
      "42+00001+BRNO_LES003a+NORMÁLNÍ+ANO+BezPoznámky.HEIC",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.isAnonymized).toBe(true);
  });

  it.each([
    ["NORMÁLNÍ", FindState.NORMAL],
    ["BEZGPS", FindState.NO_GPS],
    ["BEZFOTKY", FindState.NO_PHOTO],
    ["DAROVANÝ", FindState.DONATED],
    ["LOKACE-NEEXISTUJE", FindState.LOCATION_MISSING],
  ])("maps STATE %s → %s", (token, expected) => {
    const r = parseFindFilename(
      `100+00001+RATIBOŘ_POLE001a+${token}+NE+BezPoznámky.HEIC`,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state).toBe(expected);
  });

  it("accepts legacy transliterated NORMA_LNI_", () => {
    const r = parseFindFilename(
      "1+00001+RATIBOR__POLE001a+NORMA_LNI_+NE+BezPoznámky.HEIC",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state).toBe(FindState.NORMAL);
  });

  it.each([
    "RATIBOŘ_POLE001f",
    "ZLÍN_ČEPKOV001",
    "HOŠŤÁLKOVÁ001",
    "PRŽNO001",
    "RATIBOŘ_DOMA-JALOVEC",
    "ZLÍN_JSVAHY-SNP000",
    "ZLÍN_JSVAHY-UTB-U5-Z001",
    "NEEXISTUJE-VSETÍN000",
    "NEEXISTUJE-ZLÍN_JSVAHY-JAVOROVÁ002",
    "BIELSKO-BIALA002",
    "KRAKÓW_WAWEL001",
    "REYKJAVÍK_MIKLABRAUT001",
    "HLUBOKÁ NAD VLTAVOU_GOLFCLUB001",
    "ZLíN_JSVAHY-UTB-U5-001",
  ])("accepts location code verbatim: %s", (code) => {
    const r = parseFindFilename(
      `1+00001+${code}+NORMÁLNÍ+NE+BezPoznámky.HEIC`,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.locationCode).toBe(code);
  });

  it("rejoins notes that contain '+'", () => {
    const r = parseFindFilename(
      "1+00001+RATIBOŘ_POLE001a+NORMÁLNÍ+NE+DAR + Brášule.HEIC",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.note).toBe("DAR + Brášule");
  });

  it("fails on missing extension", () => {
    const r = parseFindFilename(
      "1+00001+RATIBOŘ_POLE001a+NORMÁLNÍ+NE+BezPoznámky",
    );
    expect(r.ok).toBe(false);
  });

  it("fails on too few segments", () => {
    const r = parseFindFilename("1+00001+RATIBOŘ_POLE001a.HEIC");
    expect(r.ok).toBe(false);
  });

  it("fails on non-numeric FIND_ID", () => {
    const r = parseFindFilename(
      "abc+00001+RATIBOŘ_POLE001a+NORMÁLNÍ+NE+BezPoznámky.HEIC",
    );
    expect(r.ok).toBe(false);
  });

  it("fails on MAP_NUMBER that is not 5 digits", () => {
    const r = parseFindFilename(
      "1+31+RATIBOŘ_POLE001a+NORMÁLNÍ+NE+BezPoznámky.HEIC",
    );
    expect(r.ok).toBe(false);
  });

  it("fails on unknown STATE", () => {
    const r = parseFindFilename(
      "1+00001+RATIBOŘ_POLE001a+FUTURE+NE+BezPoznámky.HEIC",
    );
    expect(r.ok).toBe(false);
  });

  it("fails on invalid anonymization flag", () => {
    const r = parseFindFilename(
      "1+00001+RATIBOŘ_POLE001a+NORMÁLNÍ+MAYBE+BezPoznámky.HEIC",
    );
    expect(r.ok).toBe(false);
  });
});

describe("parseMapFilename — real format", () => {
  it("parses the canonical Ratiboř example (with diacritics, spaces, parens)", () => {
    const r = parseMapFilename(
      "RATIBOŘ_POLE001a+Pole nad penzionem HORA - hlavní ultimátní naleziště (levá hrana)+GPS49.36668S+17.88867V+Z16+00026.png",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.locationCode).toBe("RATIBOŘ_POLE001a");
    expect(r.value.description).toBe(
      "Pole nad penzionem HORA - hlavní ultimátní naleziště (levá hrana)",
    );
    expect(r.value.centerLat).toBeCloseTo(49.36668, 5);
    expect(r.value.centerLng).toBeCloseTo(17.88867, 5);
    expect(r.value.zoom).toBe(16);
    expect(r.value.mapId).toBe(26);
    expect(r.value.extension).toBe("png");
  });

  it("handles longitude Z (west of Greenwich) — Dublin", () => {
    const r = parseMapFilename(
      "DUBLIN_PINEROAD001+Pine Road+GPS53.34062S+6.21562Z+Z16+00099.png",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.centerLat).toBeCloseTo(53.34062, 5);
    expect(r.value.centerLng).toBeCloseTo(-6.21562, 5);
  });

  it("handles longitude Z — Reykjavík", () => {
    const r = parseMapFilename(
      "REYKJAVÍK_MIKLABRAUT001+Miklabraut+GPS64.13547S+21.92512Z+Z15+00123.png",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.centerLng).toBeCloseTo(-21.92512, 5);
  });

  it.each([
    "HOŠŤÁLKOVÁ001",
    "HLUBOKÁ NAD VLTAVOU_GOLFCLUB001",
    "ZLÍN_JSVAHY-UTB-U5-Z001",
    "NEEXISTUJE-VSETÍN000",
  ])("accepts opaque location code: %s", (code) => {
    const r = parseMapFilename(
      `${code}+popis+GPS49.0S+17.0V+Z15+00055.png`,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.locationCode).toBe(code);
  });

  it("fails on wrong segment count", () => {
    const r = parseMapFilename("RATIBOŘ+GPS49.0S+17.0V+Z15+00055.png");
    expect(r.ok).toBe(false);
  });

  it("fails on malformed latitude", () => {
    const r = parseMapFilename(
      "RATIBOŘ_POLE001a+desc+49.0+17.0V+Z15+00055.png",
    );
    expect(r.ok).toBe(false);
  });

  it("fails on malformed zoom", () => {
    const r = parseMapFilename(
      "RATIBOŘ_POLE001a+desc+GPS49.0S+17.0V+zoom15+00055.png",
    );
    expect(r.ok).toBe(false);
  });
});

describe("splitLocationCode — best-effort decomposition", () => {
  it.each([
    [
      "RATIBOŘ_POLE001f",
      { cadastralArea: "RATIBOŘ", locationType: "POLE", number: 1, subpart: "f" },
    ],
    [
      "ZLÍN_ČEPKOV001",
      { cadastralArea: "ZLÍN", locationType: "ČEPKOV", number: 1, subpart: null },
    ],
    [
      "HOŠŤÁLKOVÁ001",
      { cadastralArea: "HOŠŤÁLKOVÁ", locationType: null, number: 1, subpart: null },
    ],
    [
      "RATIBOŘ_DOMA-JALOVEC",
      { cadastralArea: "RATIBOŘ", locationType: "DOMA-JALOVEC", number: null, subpart: null },
    ],
    [
      "ZLÍN_JSVAHY-SNP000",
      { cadastralArea: "ZLÍN", locationType: "JSVAHY-SNP", number: 0, subpart: null },
    ],
    [
      "ZLÍN_JSVAHY-UTB-U5-Z001",
      { cadastralArea: "ZLÍN", locationType: "JSVAHY-UTB-U5-Z", number: 1, subpart: null },
    ],
    [
      "HLUBOKÁ NAD VLTAVOU_GOLFCLUB001",
      { cadastralArea: "HLUBOKÁ NAD VLTAVOU", locationType: "GOLFCLUB", number: 1, subpart: null },
    ],
    [
      "NEEXISTUJE-VSETÍN000",
      { cadastralArea: "NEEXISTUJE-VSETÍN", locationType: null, number: 0, subpart: null },
    ],
    [
      "BIELSKO-BIALA002",
      { cadastralArea: "BIELSKO-BIALA", locationType: null, number: 2, subpart: null },
    ],
    [
      "KRAKÓW_WAWEL001",
      { cadastralArea: "KRAKÓW", locationType: "WAWEL", number: 1, subpart: null },
    ],
  ])("splits %s", (code, expected) => {
    expect(splitLocationCode(code)).toEqual(expected);
  });

  it("never fails — returns whole string for unrecognized shapes", () => {
    const r = splitLocationCode("WEIRD");
    expect(r.cadastralArea).toBe("WEIRD");
    expect(r.number).toBeNull();
  });
});

describe("toAsciiCode", () => {
  it.each([
    ["RATIBOŘ_POLE001f", "RATIBOR_POLE001f"],
    ["HOŠŤÁLKOVÁ001", "HOSTALKOVA001"],
    ["HLUBOKÁ NAD VLTAVOU_GOLFCLUB001", "HLUBOKA_NAD_VLTAVOU_GOLFCLUB001"],
    ["KRAKÓW_WAWEL001", "KRAKOW_WAWEL001"],
    ["ZLíN_JSVAHY", "ZLiN_JSVAHY"], // case preserved
  ])("%s → %s", (input, expected) => {
    expect(toAsciiCode(input)).toBe(expected);
  });
});
