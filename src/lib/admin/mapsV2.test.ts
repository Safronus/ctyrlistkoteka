import { describe, it, expect } from "vitest";
import { isV2ReservedMapName, assertMutableMapFile } from "./mapsV2";

// "Nosné mapy" built from code points so the test file's own encoding
// (NFC vs NFD on disk) can't make the literal ambiguous.
const NOSNE = "Nosné mapy"; // NFC: é = U+00E9
const NOSNE_NFD = NOSNE.normalize("NFD"); // e + combining acute U+0301

describe("isV2ReservedMapName", () => {
  it("flags the v2 package artifacts", () => {
    expect(isV2ReservedMapName("manifest.json")).toBe(true);
    expect(isV2ReservedMapName(NOSNE)).toBe(true);
    expect(isV2ReservedMapName("Rendered mapy")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isV2ReservedMapName("MANIFEST.JSON")).toBe(true);
    expect(isV2ReservedMapName(NOSNE.toLowerCase())).toBe(true);
  });

  it("matches regardless of NFC/NFD (rsync-from-macOS drift)", () => {
    expect(NOSNE_NFD).not.toBe(NOSNE); // sanity: it really is a distinct form
    expect(isV2ReservedMapName(NOSNE_NFD)).toBe(true);
  });

  it("lets real map files and stray v1 PNGs through", () => {
    expect(isV2ReservedMapName("CZ_BRNO_001+popis+00025.png")).toBe(false);
    expect(isV2ReservedMapName("Zlin+u reky+50.0+15.0+18+00123.png")).toBe(
      false,
    );
    expect(isV2ReservedMapName("manifest.json.png")).toBe(false);
  });
});

describe("assertMutableMapFile", () => {
  it("throws for a reserved artifact", () => {
    expect(() => assertMutableMapFile("manifest.json")).toThrow(/verze 2/);
  });

  it("is a no-op for a normal map filename", () => {
    expect(() =>
      assertMutableMapFile("CZ_BRNO_001+popis+00025.png"),
    ).not.toThrow();
  });
});
