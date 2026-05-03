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
