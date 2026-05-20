import { z } from "zod";

/** Zod schema for `LokaceStavyPoznamky.json`. Validates the shape
 *  documented in docs/data-schema.md and accepted by scripts/sync.ts.
 *
 *  Range strings are validated structurally (`"15"` or `"15-35"`)
 *  with a custom refinement that catches `start > end`, so the
 *  editor surfaces the same error parseRanges() would throw at sync
 *  time. Top-level objects use `z.strictObject` (Zod 4 API) to
 *  reject typos in keys instead of silently swallowing them. */

const rangesField = z.array(z.string()).superRefine((arr, ctx) => {
  arr.forEach((raw, i) => {
    const s = raw.trim();
    if (s === "") return;
    if (/^\d+$/.test(s)) return;
    const range = /^(\d+)-(\d+)$/.exec(s);
    if (!range) {
      ctx.addIssue({
        code: "custom",
        message: `Neplatný range "${s}" — povolené formáty: "15" nebo "15-35"`,
        path: [i],
      });
      return;
    }
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (a > b) {
      ctx.addIssue({
        code: "custom",
        message: `Range "${s}": začátek je větší než konec`,
        path: [i],
      });
    }
  });
});

export const STAVY_KEYS = [
  "BEZFOTKY",
  "BEZGPS",
  "BEZLOKACE",
  "DAROVANY",
  "LOKACE-NEEXISTUJE",
  "NEUTRZEN",
  "ZTRACENY",
] as const;

const stavyShape: Record<string, typeof rangesField> = {};
for (const k of STAVY_KEYS) stavyShape[k] = rangesField;

export const anonymizaceSchema = z.strictObject({
  ANONYMIZOVANE: rangesField,
});

export const lokaceSchema = z.record(z.string().min(1), rangesField);

export const poznamkySchema = z.record(
  z.string().regex(/^\d+$/, "Klíč musí být číslo nálezu"),
  z.string(),
);

export const stavySchema = z.strictObject(stavyShape);

export const lokaceStavyPoznamkySchema = z.strictObject({
  anonymizace: anonymizaceSchema,
  lokace: lokaceSchema,
  poznamky: poznamkySchema,
  stavy: stavySchema,
});

export type LokaceStavyPoznamky = z.infer<typeof lokaceStavyPoznamkySchema>;

export const LOKACE_STAVY_POZNAMKY_FILENAME = "LokaceStavyPoznamky.json";

/** The four top-level sections. The editor renders one tab per
 *  section, validates each independently with the matching sub-
 *  schema, and stitches them back together on save. */
export const SECTION_KEYS = [
  "lokace",
  "stavy",
  "poznamky",
  "anonymizace",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_SCHEMAS: Record<SectionKey, z.ZodTypeAny> = {
  lokace: lokaceSchema,
  stavy: stavySchema,
  poznamky: poznamkySchema,
  anonymizace: anonymizaceSchema,
};

export const SECTION_LABELS: Record<SectionKey, string> = {
  lokace: "Lokace",
  stavy: "Stavy",
  poznamky: "Poznámky",
  anonymizace: "Anonymizace",
};

// ---------------------------------------------------------------------------
// LokaceHierarchie.json — parent/child mapping between location codes.
//
// Shape: { "<parent_code>": ["<child_code>", "<child_code>", ...], ... }
// Same shape that `scripts/sync.ts` reads (readHierarchyJson). Sync
// enforces the same invariants referentially against the DB; we mirror
// the structural ones here so the admin save fails fast with field-
// level issues instead of pushing them through to the next sync run.
// ---------------------------------------------------------------------------

export const LOKACE_HIERARCHIE_FILENAME = "LokaceHierarchie.json";

export const lokaceHierarchieSchema = z
  .record(z.string().min(1), z.array(z.string().min(1)).min(1))
  .superRefine((data, ctx) => {
    const parents = new Set(Object.keys(data));
    const childToParent = new Map<string, string>();

    for (const [parent, children] of Object.entries(data)) {
      const seenInGroup = new Set<string>();
      children.forEach((child, i) => {
        if (child === parent) {
          ctx.addIssue({
            code: "custom",
            message: `Lokace "${child}" nemůže být dítětem sama sebe`,
            path: [parent, i],
          });
        }
        if (seenInGroup.has(child)) {
          ctx.addIssue({
            code: "custom",
            message: `Duplicitní dítě "${child}" ve skupině "${parent}"`,
            path: [parent, i],
          });
        }
        seenInGroup.add(child);
        if (parents.has(child)) {
          ctx.addIssue({
            code: "custom",
            message: `Lokace "${child}" je sama rodičem — max. povolená hloubka hierarchie je 2`,
            path: [parent, i],
          });
        }
        const prevParent = childToParent.get(child);
        if (prevParent && prevParent !== parent) {
          ctx.addIssue({
            code: "custom",
            message: `Lokace "${child}" je už dítětem skupiny "${prevParent}"`,
            path: [parent, i],
          });
        }
        childToParent.set(child, parent);
      });
    }
  });

export type LokaceHierarchie = z.infer<typeof lokaceHierarchieSchema>;

// ---------------------------------------------------------------------------
// clover-texts.json (CZ source of truth) + clover-texts.en.json (sidecar
// EN translations keyed by numeric id).
//
// The runtime loader in src/lib/cloverTexts.ts reads these files; admin
// CRUD writes through this schema after Zod-validating the payload. We
// keep the wrapper shape `{ texts: [...] }` so future metadata (last-
// edited, schema version) can land at top level without breaking older
// readers.
// ---------------------------------------------------------------------------

export const CLOVER_TEXTS_FILENAME = "clover-texts.json";
export const CLOVER_TRANSLATIONS_FILENAME = "clover-texts.en.json";

// Local re-declarations so this module doesn't import from the
// runtime loader (which would cycle through fs/node:path). The
// canonical exports live in src/lib/cloverFactsLabels.ts and the
// values must match — both lists are tiny, and a duplicate is
// cheaper than a circular import.
const SCHEMA_CATEGORIES = [
  "botany",
  "culture",
  "folklore",
  "history",
  "literature",
  "mythology",
  "poetry",
  "records",
  "science",
  "trivia",
] as const;
const SCHEMA_SOURCE_TYPES = ["fact", "lore", "creative"] as const;
const SCHEMA_VIBES = ["happy", "demonic"] as const;

export const cloverTextSchema = z
  .strictObject({
    id: z.number().int().positive(),
    category: z.enum(SCHEMA_CATEGORIES),
    title: z.string().min(1, "Title is required"),
    text: z.string().min(1, "Text is required"),
    source_type: z.enum(SCHEMA_SOURCE_TYPES),
    author: z.boolean().optional(),
    kind: z.string().min(1).optional(),
    vibe: z.enum(SCHEMA_VIBES).optional(),
    link: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    // vibe + kind only apply to author entries. Reject otherwise so the
    // file stays clean and the rotator doesn't have to ignore stray
    // fields silently.
    if (data.vibe && data.author !== true) {
      ctx.addIssue({
        code: "custom",
        message: "Vibe is only valid on author entries (set author: true)",
        path: ["vibe"],
      });
    }
    if (data.kind && data.author !== true) {
      ctx.addIssue({
        code: "custom",
        message: "Kind is only valid on author entries (set author: true)",
        path: ["kind"],
      });
    }
  });

export const cloverTextsFileSchema = z.strictObject({
  texts: z
    .array(cloverTextSchema)
    .min(1, "At least one text is required")
    .superRefine((arr, ctx) => {
      const seen = new Map<number, number>();
      arr.forEach((t, i) => {
        const prev = seen.get(t.id);
        if (prev !== undefined) {
          ctx.addIssue({
            code: "custom",
            message: `Duplicate id ${t.id} (also at index ${prev})`,
            path: [i, "id"],
          });
        } else {
          seen.set(t.id, i);
        }
      });
    }),
});

export type CloverTextsFile = z.infer<typeof cloverTextsFileSchema>;

export const cloverEnEntrySchema = z.strictObject({
  title: z.string().min(1),
  text: z.string().min(1),
  kind: z.string().min(1).optional(),
});

export const cloverTranslationsFileSchema = z.strictObject({
  translations: z.record(
    z.string().regex(/^\d+$/, "Translation key must be a numeric id"),
    cloverEnEntrySchema,
  ),
});

export type CloverTranslationsFile = z.infer<
  typeof cloverTranslationsFileSchema
>;
