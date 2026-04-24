import { describe, it, expect } from "vitest";
import { FindState } from "@prisma/client";
import {
  parseFindFilename,
  parseMapFilename,
  parseLocationCode,
} from "./parseFilename";

describe("parseFindFilename", () => {
  it("parses the canonical example from docs/filename-convention.md", () => {
    const r = parseFindFilename(
      "16230_00031_RATIBOR__POLE001f_NORMA_LNI__NE_BezPozna_mky.HEIC",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      findId: 16230,
      mapNumber: 31,
      locationCodeTransliterated: "RATIBOR__POLE001f",
      state: FindState.NORMAL,
      isAnonymized: false,
      hasNote: false,
      noteTransliterated: null,
      extension: "HEIC",
    });
  });

  it("captures a real note (not BezPozna_mky)", () => {
    const r = parseFindFilename(
      "156_00010_PRAHA_PARK012b_NORMA_LNI__NE_Nalezeno_v_Irsku_v_Dublinu.HEIC",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.hasNote).toBe(true);
    expect(r.value.noteTransliterated).toBe("Nalezeno_v_Irsku_v_Dublinu");
  });

  it("detects the anonymization flag (ANO)", () => {
    const r = parseFindFilename(
      "42_00001_BRNO_LES003a_NORMA_LNI__ANO_BezPozna_mky.HEIC",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.isAnonymized).toBe(true);
  });

  it("parses BEZGPS state", () => {
    const r = parseFindFilename(
      "165_00001_RATIBOR__POLE001a_BEZGPS_NE_BezPozna_mky.HEIC",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state).toBe(FindState.NO_GPS);
  });

  it("parses BEZFOTKY state", () => {
    const r = parseFindFilename(
      "734_00001_RATIBOR__POLE001a_BEZFOTKY_NE_BezPozna_mky.HEIC",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state).toBe(FindState.NO_PHOTO);
  });

  it("parses DAROVAN_ state (Ý → _ rule)", () => {
    const r = parseFindFilename(
      "14608_00001_RATIBOR__POLE001a_DAROVAN__NE_DAR_-_Brasule.HEIC",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state).toBe(FindState.DONATED);
    expect(r.value.hasNote).toBe(true);
  });

  it("parses DAROVANY_ state (Ý → Y_ rule)", () => {
    const r = parseFindFilename(
      "14608_00001_RATIBOR__POLE001a_DAROVANY__NE_BezPozna_mky.HEIC",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state).toBe(FindState.DONATED);
  });

  it("accepts HEIC/JPEG/PNG extensions equally", () => {
    const heic = parseFindFilename(
      "1_00001_BRNO_LES003a_NORMA_LNI__NE_BezPozna_mky.HEIC",
    );
    const jpeg = parseFindFilename(
      "1_00001_BRNO_LES003a_NORMA_LNI__NE_BezPozna_mky.JPEG",
    );
    const png = parseFindFilename(
      "1_00001_BRNO_LES003a_NORMA_LNI__NE_BezPozna_mky.PNG",
    );
    expect(heic.ok && jpeg.ok && png.ok).toBe(true);
  });

  it("fails cleanly on missing extension", () => {
    const r = parseFindFilename("16230_00031_FOO_NORMA_LNI__NE_BezPozna_mky");
    expect(r.ok).toBe(false);
  });

  it("fails cleanly on wrong schema (missing MAP_NUMBER)", () => {
    const r = parseFindFilename("16230_RATIBOR_POLE001f.HEIC");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/does not match/i);
  });

  it("fails cleanly on unknown STATE", () => {
    const r = parseFindFilename(
      "1_00001_BRNO_LES003a_FUTURE_NE_BezPozna_mky.HEIC",
    );
    expect(r.ok).toBe(false);
  });
});

describe("parseMapFilename", () => {
  const SAMPLE =
    "RATIBOR__POLE001a_Pole_nad_penzionem_HORA_-_hlavni__ultima_tni__nalezis_te___leva__hrana__GPS49_36668S_17_88867V_Z16_00026.png";

  it("parses the canonical example from docs/filename-convention.md §B", () => {
    const r = parseMapFilename(SAMPLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.locationCodeTransliterated).toBe("RATIBOR__POLE001a");
    expect(r.value.centerLat).toBeCloseTo(49.36668, 5);
    expect(r.value.centerLng).toBeCloseTo(17.88867, 5);
    expect(r.value.zoom).toBe(16);
    expect(r.value.mapId).toBe(26);
    expect(r.value.extension).toBe("png");
  });

  it("captures the transliterated description", () => {
    const r = parseMapFilename(SAMPLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Description keeps underscores where spaces/diacritics were
    expect(r.value.descriptionTransliterated).toContain("Pole_nad_penzionem");
  });

  it("parses a simple map without cadastral diacritics", () => {
    const r = parseMapFilename(
      "BRNO_LES003a_Simple_desc_GPS49_0S_17_5V_Z15_00055.png",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.locationCodeTransliterated).toBe("BRNO_LES003a");
    expect(r.value.centerLat).toBeCloseTo(49.0, 1);
    expect(r.value.centerLng).toBeCloseTo(17.5, 1);
    expect(r.value.zoom).toBe(15);
    expect(r.value.mapId).toBe(55);
  });

  it("fails on missing GPS anchor", () => {
    const r = parseMapFilename("RATIBOR__POLE001a_bez_gps.png");
    expect(r.ok).toBe(false);
  });

  it("fails on missing extension", () => {
    const r = parseMapFilename(
      "RATIBOR__POLE001a_foo_GPS49_0S_17_0V_Z16_00001",
    );
    expect(r.ok).toBe(false);
  });
});

describe("parseLocationCode", () => {
  it("splits a transliterated code with single diacritic (Ř)", () => {
    const r = parseLocationCode("RATIBOR__POLE001f");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      cadastralArea: "RATIBOR",
      locationType: "POLE",
      number: 1,
      subpart: "f",
    });
  });

  it("splits an original code with diacritics intact", () => {
    const r = parseLocationCode("RATIBOŘ_POLE001f");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.cadastralArea).toBe("RATIBOŘ");
    expect(r.value.locationType).toBe("POLE");
  });

  it("handles a code without subpart", () => {
    const r = parseLocationCode("PRAHA_PARK012");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      cadastralArea: "PRAHA",
      locationType: "PARK",
      number: 12,
      subpart: null,
    });
  });

  it("fails on invalid code", () => {
    expect(parseLocationCode("nonsense").ok).toBe(false);
    expect(parseLocationCode("PRAHA_PARK").ok).toBe(false);
  });
});
