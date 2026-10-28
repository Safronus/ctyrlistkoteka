import { describe, expect, it } from "vitest";
import {
  applyFindUpdateToLsp,
  parseFindUpdateExcerpt,
  parseFindUpdateManifest,
  planFindUpdate,
  type FindUpdateExcerpt,
  type FindUpdateManifest,
  type PlanInput,
  type WebFind,
} from "./findUpdatePackage";
import type { LokaceStavyPoznamky } from "@/lib/admin/jsonSchema";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

/** A composed find filename. */
function n(id: number, map: number, states: string, anon: "ANO" | "NE", note: string): string {
  return `${id}+${String(map).padStart(5, "0")}+PT_LISABON_001+${states}+${anon}+${note}.jpg`;
}

function lsp(): LokaceStavyPoznamky {
  return {
    anonymizace: { ANONYMIZOVANE: ["6-7", "500"] },
    lokace: { "10": ["100-110"], "298": ["31640-31655"] },
    poznamky: { "100": "jiná", "31650": "stará" },
    stavy: {
      BEZFOTKY: [],
      BEZGPS: [],
      DAROVANY: ["31640"],
      GIGANT: ["31650"],
      "LOKACE-NEEXISTUJE": ["36"],
      NEUTRZEN: [],
      ZTRACENY: [],
    },
  };
}

const OWNED_EMPTY = {
  BEZFOTKY: [],
  BEZGPS: [],
  DAROVANY: [],
  ZTRACENY: [],
  "LOKACE-NEEXISTUJE": [],
  NEUTRZEN: [],
};

/** The approved first case: 31650 becomes donated with a note. */
function donationCase() {
  const name = n(31650, 298, "DAROVANY", "NE", "Pro babičku");
  const manifest: FindUpdateManifest = {
    typ: "oprava-nalezu",
    schema_version: 1,
    finds: {
      "31650": {
        original: name,
        crop: name,
        imagesIncluded: true,
        sha1: { original: A, crop: B },
      },
    },
  };
  const excerpt: FindUpdateExcerpt = {
    lokace: { "298": ["31650"] },
    stavy: { ...OWNED_EMPTY, DAROVANY: ["31650"] },
    poznamky: { "31650": "Pro babičku" },
    anonymizace: { ANONYMIZOVANE: [] },
  };
  const web = new Map<number, WebFind>([
    [
      31650,
      {
        existsInDb: true,
        sha1: { original: A, crop: C },
        files: {
          finds: [n(31650, 298, "NORMÁLNÍ", "NE", "BezPoznámky")],
          crops: ["31650.jpg"],
        },
      },
    ],
  ]);
  const input: PlanInput = {
    manifest,
    excerpt,
    zipEntries: [
      { path: "manifest.json", sha1: null },
      { path: "meta/LokaceStavyPoznamky.json", sha1: null },
      { path: `finds/${name}`, sha1: A },
      { path: `crops/${name}`, sha1: B },
    ],
    lsp: lsp(),
    web,
    maps: new Map([[298, { locationId: 298, anonymized: false }]]),
    noteOverrides: new Set([31650]),
  };
  return { input, name };
}

describe("planFindUpdate — happy path (the donation case)", () => {
  it("passes and describes the change", () => {
    const { input, name } = donationCase();
    const plan = planFindUpdate(input);
    expect(plan.errors).toEqual([]);
    expect(plan.ok).toBe(true);
    const f = plan.finds[0]!;
    expect(f.findId).toBe(31650);
    expect(f.errors).toEqual([]);
    expect(f.before.states).toEqual(["GIGANT"]);
    // DAROVANY added, GIGANT (the web's own) kept.
    expect(f.after.states).toEqual(["DAROVANY", "GIGANT"]);
    expect(f.before.note).toBe("stará");
    expect(f.after.note).toBe("Pro babičku");
    expect(f.after.original).toBe(name);
    expect(f.before.crop).toBe("31650.jpg");
    // Original bytes unchanged → rename only; crop is a new photo.
    expect(f.images).toEqual({ original: "same", crop: "changed" });
    // R8: note changed and an override exists → it goes.
    expect(f.noteOverride).toBe("removed");
    expect(f.changed).toBe(true);
  });

  it("keeps the note override when the note text doesn't change", () => {
    const { input } = donationCase();
    input.excerpt.poznamky["31650"] = "stará";
    input.manifest.finds["31650"]!.original = n(31650, 298, "DAROVANY", "NE", "stará");
    input.manifest.finds["31650"]!.crop = input.manifest.finds["31650"]!.original;
    input.zipEntries = [
      { path: "manifest.json", sha1: null },
      { path: "meta/LokaceStavyPoznamky.json", sha1: null },
      { path: `finds/${n(31650, 298, "DAROVANY", "NE", "stará")}`, sha1: A },
      { path: `crops/${n(31650, 298, "DAROVANY", "NE", "stará")}`, sha1: B },
    ];
    expect(planFindUpdate(input).finds[0]!.noteOverride).toBe("kept");
  });
});

describe("applyFindUpdateToLsp", () => {
  const ids = new Set([31650]);

  it("replaces the desktop-owned parts and leaves GIGANT and other finds alone", () => {
    const { input } = donationCase();
    const next = applyFindUpdateToLsp(lsp(), input.excerpt, ids);
    expect(next.stavy.DAROVANY).toEqual(["31640", "31650"]);
    expect(next.stavy.GIGANT).toEqual(["31650"]);
    expect(next.stavy["LOKACE-NEEXISTUJE"]).toEqual(["36"]);
    expect(next.poznamky).toEqual({ "100": "jiná", "31650": "Pro babičku" });
    expect(next.anonymizace.ANONYMIZOVANE).toEqual(["6-7", "500"]);
    // The find stays in 298: same membership, so the original strings are
    // kept verbatim (no needless reformatting of the live file).
    expect(next.lokace["298"]).toEqual(["31640-31655"]);
    expect(next.lokace["10"]).toEqual(["100-110"]);
  });

  it("removes what the excerpt no longer says (un-donate, drop note, un-anonymise)", () => {
    const base = lsp();
    base.stavy.DAROVANY = ["31640-31660"];
    base.anonymizace.ANONYMIZOVANE = ["31650"];
    const excerpt: FindUpdateExcerpt = {
      lokace: { "298": ["31650"] },
      stavy: { ...OWNED_EMPTY },
      poznamky: {},
      anonymizace: { ANONYMIZOVANE: [] },
    };
    const next = applyFindUpdateToLsp(base, excerpt, ids);
    expect(next.stavy.DAROVANY).toEqual(["31640-31649", "31651-31660"]);
    expect(next.poznamky["31650"]).toBeUndefined();
    expect(next.anonymizace.ANONYMIZOVANE).toEqual([]);
    expect(next.stavy.GIGANT).toEqual(["31650"]);
  });

  it("moves a find to another location", () => {
    const excerpt: FindUpdateExcerpt = {
      lokace: { "10": ["31650"] },
      stavy: { ...OWNED_EMPTY },
      poznamky: {},
      anonymizace: { ANONYMIZOVANE: [] },
    };
    const next = applyFindUpdateToLsp(lsp(), excerpt, ids);
    expect(next.lokace["298"]).toEqual(["31640-31649", "31651-31655"]);
    expect(next.lokace["10"]).toEqual(["100-110", "31650"]);
  });

  it("creates a location key the live file doesn't have yet", () => {
    const excerpt: FindUpdateExcerpt = {
      lokace: { "777": ["31650"] },
      stavy: {},
      poznamky: {},
      anonymizace: { ANONYMIZOVANE: [] },
    };
    expect(applyFindUpdateToLsp(lsp(), excerpt, ids).lokace["777"]).toEqual(["31650"]);
  });

  it("leaves a stavy key absent from the excerpt untouched", () => {
    const base = lsp();
    base.stavy.DAROVANY = ["31650"];
    const excerpt: FindUpdateExcerpt = {
      lokace: { "298": ["31650"] },
      stavy: { ZTRACENY: ["31650"] },
      poznamky: {},
      anonymizace: { ANONYMIZOVANE: [] },
    };
    const next = applyFindUpdateToLsp(base, excerpt, ids);
    expect(next.stavy.DAROVANY).toEqual(["31650"]);
    expect(next.stavy.ZTRACENY).toEqual(["31650"]);
  });

  it("is idempotent", () => {
    const { input } = donationCase();
    const once = applyFindUpdateToLsp(lsp(), input.excerpt, ids);
    const twice = applyFindUpdateToLsp(once, input.excerpt, ids);
    expect(twice).toEqual(once);
  });
});

describe("planFindUpdate — validation (one error per rule)", () => {
  const errorsOf = (mutate: (i: PlanInput) => void) => {
    const { input } = donationCase();
    mutate(input);
    const plan = planFindUpdate(input);
    expect(plan.ok).toBe(false);
    return [...plan.errors, ...plan.finds.flatMap((f) => f.errors)].join("\n");
  };

  it("V2: the find must already be on the site", () => {
    expect(errorsOf((i) => i.web.get(31650)!.existsInDb = false)).toMatch(/^V2:/m);
  });

  it("V3: the name must carry the manifest's number", () => {
    expect(
      errorsOf((i) => {
        const bad = n(31651, 298, "DAROVANY", "NE", "Pro babičku");
        i.manifest.finds["31650"]!.original = bad;
        i.zipEntries = i.zipEntries.map((e, k) => (k === 2 ? { path: `finds/${bad}`, sha1: A } : e));
      }),
    ).toMatch(/V3: originál .* nese číslo 31651/);
  });

  it("V3: original and crop must carry the same name", () => {
    expect(
      errorsOf((i) => {
        const other = n(31650, 298, "DAROVANY", "ANO", "Pro babičku");
        i.manifest.finds["31650"]!.crop = other;
        i.zipEntries = i.zipEntries.map((e, k) => (k === 3 ? { path: `crops/${other}`, sha1: B } : e));
      }),
    ).toMatch(/V3: originál a ořez musí nést stejný název/);
  });

  it("V3: a name may not carry a path separator", () => {
    expect(
      errorsOf((i) => {
        const bad = n(31650, 298, "DAROVANY", "NE", "a/../../x");
        i.manifest.finds["31650"]!.original = bad;
        i.manifest.finds["31650"]!.crop = bad;
        i.zipEntries = i.zipEntries.map((e, k) =>
          k === 2 ? { path: `finds/${bad}`, sha1: A } : k === 3 ? { path: `crops/${bad}`, sha1: B } : e,
        );
      }),
    ).toMatch(/V3: originál .* obsahuje oddělovač cesty/);
  });

  it("V4: nothing outside the manifest", () => {
    expect(errorsOf((i) => (i.zipEntries = [...i.zipEntries, { path: "finds/99999.jpg", sha1: C }]))).toMatch(
      /V4: soubor finds\/99999\.jpg v manifestu není/,
    );
  });

  it("V4: a listed file must be in the zip", () => {
    expect(errorsOf((i) => (i.zipEntries = i.zipEntries.slice(0, 3)))).toMatch(/V4: ořez .* v ZIPu chybí/);
  });

  it("V5: the excerpt speaks only about manifest finds", () => {
    expect(errorsOf((i) => (i.excerpt.poznamky["100"] = "cizí"))).toMatch(/V5: .*100/);
  });

  it("V6: exactly one location, equal to the name's map", () => {
    expect(errorsOf((i) => (i.excerpt.lokace = { "10": ["31650"] }))).toMatch(/V6: lokace ve výřezu \(10\) nesedí/);
    expect(errorsOf((i) => (i.excerpt.lokace = { "298": ["31650"], "10": ["31650"] }))).toMatch(/V6: .*2×/);
    expect(errorsOf((i) => (i.excerpt.lokace = {}))).toMatch(/V6: .*0×/);
  });

  it("V6: the map must exist on the site", () => {
    expect(errorsOf((i) => (i.maps = new Map()))).toMatch(/V6: mapa 00298 na webu neexistuje/);
  });

  it("V7: ANO in the name ⇔ in ANONYMIZOVANE", () => {
    expect(errorsOf((i) => (i.excerpt.anonymizace.ANONYMIZOVANE = ["31650"]))).toMatch(/^V7: nález je v/m);
  });

  it("V7b: NE on an anonymised map is refused", () => {
    expect(errorsOf((i) => (i.maps = new Map([[298, { locationId: 298, anonymized: true }]])))).toMatch(/^V7b:/m);
  });

  it("V8: checksums must match the bytes", () => {
    expect(
      errorsOf((i) => (i.zipEntries = i.zipEntries.map((e, k) => (k === 2 ? { ...e, sha1: C } : e)))),
    ).toMatch(/V8: originál/);
  });

  it("V10: GIGANT and unknown stavy keys are refused", () => {
    expect(errorsOf((i) => (i.excerpt.stavy.GIGANT = ["31650"]))).toMatch(/V10: .*GIGANT/);
    expect(errorsOf((i) => (i.excerpt.stavy.BEZLOKACE = []))).toMatch(/V10: neznámý klíč stavy\.BEZLOKACE/);
  });

  it("a missing desktop-owned key is only a warning", () => {
    const { input } = donationCase();
    delete (input.excerpt.stavy as Record<string, string[]>).NEUTRZEN;
    const plan = planFindUpdate(input);
    expect(plan.ok).toBe(true);
    expect(plan.warnings.join()).toMatch(/NEUTRZEN/);
  });

  it("warns when the name's states disagree with the excerpt", () => {
    const { input } = donationCase();
    input.excerpt.stavy.ZTRACENY = ["31650"];
    const plan = planFindUpdate(input);
    expect(plan.ok).toBe(true);
    const warning = plan.finds[0]!.warnings.join();
    // In the excerpt's own vocabulary, not the DB enum.
    expect(warning).toBe("Stav v názvu (DAROVANY) nesedí se stavy ve výřezu (DAROVANY, ZTRACENY).");
  });

  it("does not warn when name and excerpt agree", () => {
    const { input } = donationCase();
    expect(planFindUpdate(input).finds[0]!.warnings).toEqual([]);
  });
});

describe("parseFindUpdateManifest / parseFindUpdateExcerpt", () => {
  const good = {
    typ: "oprava-nalezu",
    schema_version: 1,
    generator: "desktop 5.6",
    finds: {
      "31650": {
        original: n(31650, 298, "DAROVANY", "NE", "x"),
        crop: n(31650, 298, "DAROVANY", "NE", "x"),
        imagesIncluded: true,
        sha1: { original: A, crop: B },
      },
    },
  };

  it("accepts the contract's shape and NFC-normalises names", () => {
    const nfd = n(31650, 298, "DAROVANY", "NE", "Pro babičku").normalize("NFD");
    const r = parseFindUpdateManifest(
      JSON.stringify({ ...good, finds: { "31650": { ...good.finds["31650"], original: nfd, crop: nfd } } }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.finds["31650"]!.original).toBe(nfd.normalize("NFC"));
  });

  it.each([
    ["wrong typ", { ...good, typ: "update" }],
    ["unknown schema_version", { ...good, schema_version: 2 }],
    ["leading zero key", { ...good, finds: { "031650": good.finds["31650"] } }],
    ["no finds", { ...good, finds: {} }],
    ["imagesIncluded false", { ...good, finds: { "31650": { ...good.finds["31650"], imagesIncluded: false } } }],
    ["uppercase sha1", { ...good, finds: { "31650": { ...good.finds["31650"], sha1: { original: A.toUpperCase(), crop: B } } } }],
    ["missing crop", { ...good, finds: { "31650": { ...good.finds["31650"], crop: undefined } } }],
  ])("rejects %s", (_label, manifest) => {
    expect(parseFindUpdateManifest(JSON.stringify(manifest)).ok).toBe(false);
  });

  it("rejects an excerpt without the anonymizace section or with a bad range", () => {
    const base = { lokace: {}, stavy: {}, poznamky: {}, anonymizace: { ANONYMIZOVANE: [] } };
    expect(parseFindUpdateExcerpt(JSON.stringify(base)).ok).toBe(true);
    expect(parseFindUpdateExcerpt(JSON.stringify({ ...base, anonymizace: {} })).ok).toBe(false);
    expect(parseFindUpdateExcerpt(JSON.stringify({ ...base, lokace: { "1": ["9-3"] } })).ok).toBe(false);
  });
});
