import { describe, expect, it } from "vitest";
import {
  locationNumber,
  parsePhotoName,
  parsePhotoPackageManifest,
  readPackageTyp,
  storedPhotoName,
} from "./locationPhotoPackage";

const MANIFEST = JSON.stringify({
  typ: "fotky-lokaci",
  vytvoreno: "2026-08-22 23:03:39",
  pocet_fotek: 1,
  schema_metadat: 1,
  plochy_vypalene: true,
  originaly_prilozeny: false,
  fotky: [
    {
      cislo_lokace: "00010",
      soubor: "location-photos/00010/00010_foto001.png",
      poradi: 1,
      popisek: "",
      pocet_ploch: 1,
      plochy_vypalene: true,
    },
  ],
});

describe("parsePhotoPackageManifest", () => {
  it("reads the real package's manifest", () => {
    const r = parsePhotoPackageManifest(MANIFEST);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fotky).toHaveLength(1);
    expect(r.value.fotky[0]).toMatchObject({
      cislo_lokace: "00010",
      poradi: 1,
      pocet_ploch: 1,
    });
  });

  it("refuses a manifest of another package type", () => {
    // The map package carries a manifest at the same path; misreading one
    // for the other is the failure this guards.
    const r = parsePhotoPackageManifest(
      JSON.stringify({ typ: "lokacni-mapy", schema_metadat: 2, mapy: [] }),
    );
    expect(r.ok).toBe(false);
  });

  it.each([
    ["nečitelný JSON", "{ tohle není json"],
    [
      "číslo lokace bez vodicích nul",
      JSON.stringify({
        typ: "fotky-lokaci",
        schema_metadat: 1,
        fotky: [{ cislo_lokace: "10", soubor: "a.png", poradi: 1 }],
      }),
    ],
    [
      "jiná verze schématu",
      JSON.stringify({ typ: "fotky-lokaci", schema_metadat: 2, fotky: [] }),
    ],
    [
      "pořadí od nuly",
      JSON.stringify({
        typ: "fotky-lokaci",
        schema_metadat: 1,
        fotky: [{ cislo_lokace: "00010", soubor: "a.png", poradi: 0 }],
      }),
    ],
  ])("refuses %s", (_label, json) => {
    expect(parsePhotoPackageManifest(json).ok).toBe(false);
  });

  it("normalises captions to NFC", () => {
    // macOS hands over decomposed text; the same caption would otherwise
    // compare unequal to itself after a round trip through the store.
    // Written out as code points so the test file's own encoding cannot
    // quietly make the two sides equal.
    const decomposed = "u la\u0301vky nad R\u030Cec\u030Ckou";
    const r = parsePhotoPackageManifest(
      JSON.stringify({
        typ: "fotky-lokaci",
        schema_metadat: 1,
        fotky: [
          {
            cislo_lokace: "00010",
            soubor: "location-photos/00010/00010_foto001.png",
            poradi: 1,
            popisek: decomposed,
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fotky[0]!.popisek).toBe(decomposed.normalize("NFC"));
    expect(r.value.fotky[0]!.popisek).not.toBe(decomposed);
  });
});

describe("readPackageTyp", () => {
  it("names the type without validating the rest", () => {
    expect(readPackageTyp(MANIFEST)).toBe("fotky-lokaci");
    expect(readPackageTyp('{"typ":"lokacni-mapy"}')).toBe("lokacni-mapy");
    // A manifest this build cannot validate must still be routable.
    expect(readPackageTyp('{"typ":"fotky-lokaci","schema_metadat":99}')).toBe(
      "fotky-lokaci",
    );
    expect(readPackageTyp("{}")).toBeNull();
    expect(readPackageTyp("nonsense")).toBeNull();
  });
});

describe("parsePhotoName", () => {
  it("reads the number and the order", () => {
    expect(parsePhotoName("00126_foto002.png")).toEqual({
      number: "00126",
      locationId: 126,
      order: 2,
    });
    // Leading zeros are the join key's spelling, not its value.
    expect(parsePhotoName("00010_foto001.png")?.locationId).toBe(10);
    // The importer writes WebP under the same convention.
    expect(parsePhotoName("00010_foto001.webp")?.order).toBe(1);
    // More than three digits of order, per the spec's `{3,}`.
    expect(parsePhotoName("00010_foto0123.png")?.order).toBe(123);
  });

  it.each([
    "00010_foto001.HEIC",
    "10_foto001.png",
    "00010_foto1.png",
    "00010foto001.png",
    "ZLÍN_reálné foto.png",
    "00010_foto001.png.txt",
  ])("refuses %s", (name) => {
    expect(parsePhotoName(name)).toBeNull();
  });

  it("reads tolerantly, whatever case the package used", () => {
    // Same rule as the state tokens in a find's filename: reading forgives,
    // writing has exactly one form (storedPhotoName below).
    expect(parsePhotoName("00010_foto001.PNG")).not.toBeNull();
    expect(parsePhotoName("00010_FOTO001.png")?.order).toBe(1);
    expect(storedPhotoName("00010", 1)).toBe("00010_foto001.webp");
  });
});

describe("storedPhotoName", () => {
  it("keeps the package's own spelling, as WebP", () => {
    expect(storedPhotoName("00010", 1)).toBe("00010_foto001.webp");
    expect(storedPhotoName("00126", 12)).toBe("00126_foto012.webp");
    // Round trip: what we store, we can read back.
    expect(parsePhotoName(storedPhotoName("00126", 7))).toEqual({
      number: "00126",
      locationId: 126,
      order: 7,
    });
  });

  it("writes a location id the way the package writes it", () => {
    expect(locationNumber(10)).toBe("00010");
    expect(locationNumber(126)).toBe("00126");
  });
});
