import { describe, it, expect } from "vitest";
import { FindState } from "@/generated/prisma/enums";
import { formatFilenameStates, FILENAME_STATE_MAP } from "./stateMapping";
import {
  findPhotoMapNumber,
  parseFindFilename,
  parseMapFilename,
  planFindPhotoRenames,
  withNewLocationCode,
} from "./parseFilename";
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
      states: [FindState.NORMAL],
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
    ["DAROVANY", FindState.DONATED],
    ["ZTRACENÝ", FindState.LOST],
    ["ZTRACENY", FindState.LOST],
    ["NEUTRŽEN", FindState.NOT_PICKED],
    ["NEUTRZEN", FindState.NOT_PICKED],
    ["BEZLOKACE", FindState.LOCATION_MISSING],
    ["LOKACE-NEEXISTUJE", FindState.LOCATION_GONE],
  ])("maps STATE %s → %s", (token, expected) => {
    const r = parseFindFilename(
      `100+00001+RATIBOŘ_POLE001a+${token}+NE+BezPoznámky.HEIC`,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.states).toEqual([expected]);
  });

  it.each([
    ["DAROVANÝ,ZTRACENÝ", [FindState.DONATED, FindState.LOST]],
    // Accented and ASCII spellings mix freely — both are in the map.
    ["DAROVANY,ZTRACENÝ", [FindState.DONATED, FindState.LOST]],
    // A repeat says nothing extra, so it collapses instead of failing.
    ["DAROVANÝ,DAROVANY", [FindState.DONATED]],
    // A stray space is a slip, not a reason to refuse a whole photo.
    ["DAROVANÝ, ZTRACENÝ", [FindState.DONATED, FindState.LOST]],
    ["BEZGPS,DAROVANÝ,ZTRACENÝ", [
      FindState.NO_GPS,
      FindState.DONATED,
      FindState.LOST,
    ]],
  ])("reads the state list %s", (segment, expected) => {
    const r = parseFindFilename(
      `300+00007+ZLÍN_ČEPKOV001+${segment}+NE+BezPoznámky.HEIC`,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.states).toEqual(expected);
  });

  it.each([
    // NORMAL means "nothing to report"; combining it is a contradiction,
    // and swallowing it would leave the collection quietly wrong.
    ["NORMÁLNÍ,DAROVANÝ", /NORM/],
    ["DAROVANÝ,NORMÁLNÍ", /NORM/],
    // Stray separators — a slip while editing the name.
    ["DAROVANÝ,", /Empty STATE/],
    [",DAROVANÝ", /Empty STATE/],
    ["DAROVANÝ,,ZTRACENÝ", /Empty STATE/],
    [",", /Empty STATE/],
    // A typo inside an otherwise valid list must not pass.
    ["DAROVANÝ,DAROVANEJ", /DAROVANEJ/],
  ])("refuses the state list %s", (segment, message) => {
    const r = parseFindFilename(
      `300+00007+BRNO_LES003a+${segment}+NE+BezPoznámky.HEIC`,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(message);
  });

  it("treats the same states in a different order as the same fact", () => {
    // Everything downstream compares by set; the parser keeps whatever
    // order the name used, so a rename never churns for nothing.
    const a = parseFindFilename(
      "300+00007+ZLÍN_ČEPKOV001+DAROVANÝ,ZTRACENÝ,BEZGPS+NE+BezPoznámky.HEIC",
    );
    const b = parseFindFilename(
      "300+00007+ZLÍN_ČEPKOV001+BEZGPS,DAROVANÝ,ZTRACENÝ+NE+BezPoznámky.HEIC",
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.states).not.toEqual(b.value.states);
    expect([...a.value.states].sort()).toEqual([...b.value.states].sort());
  });

  it("leaves a note full of commas alone", () => {
    // The note is segment 6 and is parsed on its own — the comma in the
    // STATE segment cannot reach into it.
    const r = parseFindFilename(
      "300+00007+BRNO_LES003a+DAROVANÝ,ZTRACENÝ+NE+Zlín, Čepkov, u lávky.HEIC",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.states).toEqual([FindState.DONATED, FindState.LOST]);
    expect(r.value.note).toBe("Zlín, Čepkov, u lávky");
  });

  it("accepts legacy transliterated NORMA_LNI_", () => {
    const r = parseFindFilename(
      "1+00001+RATIBOR__POLE001a+NORMA_LNI_+NE+BezPoznámky.HEIC",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.states).toEqual([FindState.NORMAL]);
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

describe("withNewLocationCode — Phase-E rename primitive", () => {
  it("swaps only the LOCATION_CODE segment, keeping everything else", () => {
    expect(
      withNewLocationCode(
        "16230+00042+CZ_ZLÍN_OLD_001+NORMÁLNÍ+NE+BezPoznámky.webp",
        "CZ_ZLÍN_NEW_001",
      ),
    ).toBe("16230+00042+CZ_ZLÍN_NEW_001+NORMÁLNÍ+NE+BezPoznámky.webp");
  });

  it("preserves a note that itself contains '+'", () => {
    expect(
      withNewLocationCode(
        "5+00007+OLD+NORMÁLNÍ+NE+u lavičky + koš.webp",
        "NEW",
      ),
    ).toBe("5+00007+NEW+NORMÁLNÍ+NE+u lavičky + koš.webp");
  });

  it("returns null for a short-form crop (no code segment)", () => {
    expect(withNewLocationCode("16230.jpg", "NEW")).toBeNull();
  });

  it("returns null when the code is already current (no rename needed)", () => {
    expect(
      withNewLocationCode("5+00007+SAME+NORMÁLNÍ+NE+BezPoznámky.webp", "SAME"),
    ).toBeNull();
  });

  it("returns null when there's no extension", () => {
    expect(withNewLocationCode("5+00007+OLD+NORMÁLNÍ+NE", "NEW")).toBeNull();
  });

  it("normalises both sides to NFC before comparing / writing", () => {
    // Input in NFD (Á = A + combining acute), new code in NFC.
    const nfd = "5+00007+CZ_ZLÍN_OLD+NORMÁLNÍ+NE+x.webp";
    const out = withNewLocationCode(nfd, "CZ_ZLÍN_NEW");
    expect(out).toBe("5+00007+CZ_ZLÍN_NEW+NORMÁLNÍ+NE+x.webp");
    expect(out).toBe(out!.normalize("NFC"));
  });
});

describe("findPhotoMapNumber", () => {
  it("reads the 5-digit MAP_NUMBER from a full-form name", () => {
    expect(
      findPhotoMapNumber("16230+00042+CODE+NORMÁLNÍ+NE+x.webp"),
    ).toBe(42);
  });
  it("is null for a short-form crop and a name without extension", () => {
    expect(findPhotoMapNumber("16230.jpg")).toBeNull();
    expect(findPhotoMapNumber("16230+00042+CODE+NORMÁLNÍ+NE")).toBeNull();
  });
});

describe("planFindPhotoRenames", () => {
  const files = [
    "1+00007+CZ_OLD+NORMÁLNÍ+NE+a.webp", // changed → rename
    "2+00007+CZ_OLD+DAROVANÝ+NE+b.webp", // changed → rename (same location)
    "3+00007+CZ_NEW+NORMÁLNÍ+NE+c.webp", // already the new code → skip
    "4+00099+CZ_OTHER+NORMÁLNÍ+NE+d.webp", // location not in the map → skip
    "5.jpg", // short-form crop → skip
  ];

  it("plans only files whose location changed and aren't already current", () => {
    const plan = planFindPhotoRenames(files, new Map([[7, "CZ_NEW"]]));
    expect(plan).toEqual([
      { oldName: files[0], newName: "1+00007+CZ_NEW+NORMÁLNÍ+NE+a.webp" },
      { oldName: files[1], newName: "2+00007+CZ_NEW+DAROVANÝ+NE+b.webp" },
    ]);
  });

  it("returns nothing when no listed number changed", () => {
    expect(planFindPhotoRenames(files, new Map([[123, "X"]]))).toEqual([]);
  });

  it("skips a code that would introduce a path separator", () => {
    const plan = planFindPhotoRenames(
      ["1+00007+CZ_OLD+NORMÁLNÍ+NE+a.webp"],
      new Map([[7, "CZ/EVIL"]]),
    );
    expect(plan).toEqual([]);
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
    // Regression: trailing underscore before the 3-digit block (no
    // type segment) used to leak into the cadastral as
    // "NOVÝSMOKOVEC_", splitting the city dropdown into two buckets.
    [
      "NOVÝSMOKOVEC_001",
      { cadastralArea: "NOVÝSMOKOVEC", locationType: null, number: 1, subpart: null },
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

describe("zapsaná podoba stavu", () => {
  /**
   * The archive spells DAROVANY and ZTRACENY without diacritics while
   * NORMÁLNÍ keeps them. A rename must follow the collection, not the
   * dictionary — otherwise `grep DAROVANY` stops finding everything, and
   * the archive ends up with two spellings of one state. This has already
   * gone wrong once, hence the test.
   */
  it("píše tokeny tak, jak je píše sbírka", () => {
    expect(formatFilenameStates([FindState.DONATED])).toBe("DAROVANY");
    expect(formatFilenameStates([FindState.LOST])).toBe("ZTRACENY");
    expect(formatFilenameStates([FindState.NORMAL])).toBe("NORMÁLNÍ");
    expect(formatFilenameStates([FindState.DONATED, FindState.LOST])).toBe(
      "DAROVANY,ZTRACENY",
    );
  });

  it("co zapíše, to zase přečte", () => {
    for (const s of [
      FindState.NORMAL,
      FindState.DONATED,
      FindState.LOST,
      FindState.NO_GPS,
      FindState.NO_PHOTO,
      FindState.NOT_PICKED,
      FindState.LOCATION_MISSING,
      FindState.LOCATION_GONE,
    ]) {
      const token = formatFilenameStates([s]);
      expect(FILENAME_STATE_MAP.get(token), token).toBe(s);
    }
  });

  it("rozparsuje skutečný název ze sbírky", () => {
    const r = parseFindFilename(
      "14561+00009+CZ_ZLÍN_JIŽNÍSVAHY_NAHONECHI_001+ZTRACENY+NE+Ztracený při hledání čísla 14609 -> cca 21-9-2025 v 0953 kvůli větru.jpg",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.findId).toBe(14561);
    expect(r.value.states).toEqual([FindState.LOST]);
    expect(r.value.isAnonymized).toBe(false);
    expect(r.value.hasNote).toBe(true);
  });
});
