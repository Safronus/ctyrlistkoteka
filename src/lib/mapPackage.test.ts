import { describe, it, expect } from "vitest";
import {
  parseMapPackageManifest,
  buildIdToNumber,
  entryNumber,
  displayNameFor,
  polygonWkt,
  resolveParentNumber,
  type MapPackageEntry,
} from "./mapPackage";

/** Minimal valid entry; override per test. */
function entry(over: Partial<MapPackageEntry> = {}): MapPackageEntry {
  return {
    cislo: "00210",
    id_lokace: "CZ_TEST_001",
    popis: "BezPoznámky",
    stat: "CZ",
    mesto: "Test",
    gps_lat: 49,
    gps_lon: 17,
    zoom: 17,
    render_zoom: 18,
    output_w_px: 1342,
    output_h_px: 944,
    indikator: "dot",
    radius_m: null,
    aoi_polygon_gps: null,
    aoi_area_m2: null,
    anonymizovana: false,
    zrusena: false,
    rodicovska: false,
    potomek: null,
    geo_adresa: null,
    soubory: { "Nosné mapy": "a.png" },
    ...over,
  };
}

function manifestJson(mapy: MapPackageEntry[]): string {
  return JSON.stringify({ typ: "lokacni-mapy", schema_metadat: 2, mapy });
}

describe("parseMapPackageManifest", () => {
  it("accepts a valid v2 manifest", () => {
    const r = parseMapPackageManifest(manifestJson([entry()]));
    expect(r.ok).toBe(true);
  });

  it("rejects invalid JSON", () => {
    const r = parseMapPackageManifest("{not json");
    expect(r.ok).toBe(false);
  });

  it("rejects a v1-style manifest (schema_metadat != 2)", () => {
    const r = parseMapPackageManifest(
      JSON.stringify({ typ: "lokacni-mapy", schema_metadat: 1, mapy: [] }),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown indicator", () => {
    const bad = { ...entry(), indikator: "square" };
    const r = parseMapPackageManifest(
      JSON.stringify({ typ: "lokacni-mapy", schema_metadat: 2, mapy: [bad] }),
    );
    expect(r.ok).toBe(false);
  });

  it("normalizes id_lokace/popis to NFC", () => {
    // "Ř" as R + combining caron (NFD) must come back composed (NFC).
    const nfd = "CZ_RATIBOŘ_001";
    const r = parseMapPackageManifest(manifestJson([entry({ id_lokace: nfd })]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.mapy[0]!.id_lokace).toBe("CZ_RATIBOŘ_001");
  });
});

describe("entryNumber", () => {
  it("parses a zero-padded číslo to an int", () => {
    expect(entryNumber(entry({ cislo: "00210" }))).toBe(210);
    expect(entryNumber(entry({ cislo: "3" }))).toBe(3);
  });
});

describe("displayNameFor", () => {
  it("uses popis when present", () => {
    expect(displayNameFor(entry({ popis: "Levá hrana" }))).toBe("Levá hrana");
  });
  it("falls back to geo_adresa when popis is the empty marker", () => {
    expect(
      displayNameFor(entry({ popis: "BezPoznámky", geo_adresa: "Svěrákova 161" })),
    ).toBe("Svěrákova 161");
  });
  it("falls back to id_lokace when both are missing", () => {
    expect(
      displayNameFor(entry({ popis: "BezPoznámky", geo_adresa: null, id_lokace: "CZ_X_001" })),
    ).toBe("CZ_X_001");
  });
});

describe("polygonWkt", () => {
  it("returns null for a non-polygon entry", () => {
    expect(polygonWkt(entry({ aoi_polygon_gps: null }))).toBeNull();
  });
  it("swaps [lat, lon] → 'lon lat' and closes the ring", () => {
    const wkt = polygonWkt(
      entry({
        aoi_polygon_gps: [
          [49.1, 17.1],
          [49.2, 17.1],
          [49.2, 17.2],
        ],
      }),
    );
    // lon first, and the first point repeated to close.
    expect(wkt).toBe("POLYGON((17.1 49.1, 17.1 49.2, 17.2 49.2, 17.1 49.1))");
  });
  it("does not double-close an already-closed ring", () => {
    const wkt = polygonWkt(
      entry({
        aoi_polygon_gps: [
          [49.1, 17.1],
          [49.2, 17.1],
          [49.2, 17.2],
          [49.1, 17.1],
        ],
      }),
    );
    expect(wkt).toBe("POLYGON((17.1 49.1, 17.1 49.2, 17.2 49.2, 17.1 49.1))");
  });
});

describe("resolveParentNumber", () => {
  const parent = entry({ cislo: "00003", id_lokace: "CZ_RATIBOŘ_POLE_001", rodicovska: true });
  const child = entry({ cislo: "00026", id_lokace: "CZ_RATIBOŘ_POLE_001-A", potomek: "CZ_RATIBOŘ_POLE_001" });

  it("returns null for a non-child", () => {
    const idToNum = buildIdToNumber({ typ: "lokacni-mapy", schema_metadat: 2, mapy: [parent] });
    expect(resolveParentNumber(parent, idToNum)).toBeNull();
  });

  it("resolves the parent number from the manifest", () => {
    const idToNum = buildIdToNumber({ typ: "lokacni-mapy", schema_metadat: 2, mapy: [parent, child] });
    expect(resolveParentNumber(child, idToNum)).toBe(3);
  });

  it("uses the DB fallback when the parent isn't in the package", () => {
    const idToNum = buildIdToNumber({ typ: "lokacni-mapy", schema_metadat: 2, mapy: [child] });
    expect(resolveParentNumber(child, idToNum, (id) => (id === "CZ_RATIBOŘ_POLE_001" ? 3 : null))).toBe(3);
  });
});
