import { z } from "zod";

/** Zod schema for `LokaceStavyPoznamky.json`. Validates the shape
 *  documented in docs/data-schema.md and accepted by scripts/sync.ts.
 *
 *  The editor calls this on every save so a malformed payload never
 *  reaches disk — we'd rather reject with a precise error than write
 *  invalid data and have sync.ts choke on it later.
 *
 *  Range strings are validated structurally (`"15"` or `"15-35"`)
 *  with a custom refinement that catches `start > end` ranges, so
 *  the editor surfaces the same error parseRanges() would throw at
 *  sync time. Top-level objects are .strict() to prevent typos
 *  in keys silently turning into noise. */

const rangesField = z.array(z.string()).superRefine((arr, ctx) => {
  arr.forEach((raw, i) => {
    const s = raw.trim();
    if (s === "") return; // empty entries silently dropped by sync
    if (/^\d+$/.test(s)) return; // single-ID form is fine
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

const STAVY_KEYS = [
  "BEZFOTKY",
  "BEZGPS",
  "BEZLOKACE",
  "DAROVANY",
  "LOKACE-NEEXISTUJE",
  "NEUTRZEN",
  "ZTRACENY",
] as const;

const stavyShape = STAVY_KEYS.reduce<Record<string, typeof rangesField>>(
  (acc, k) => {
    acc[k] = rangesField;
    return acc;
  },
  {},
);

export const lokaceStavyPoznamkySchema = z
  .object({
    anonymizace: z
      .object({
        ANONYMIZOVANE: rangesField,
      })
      .strict(),
    lokace: z.record(z.string().min(1), rangesField),
    poznamky: z.record(
      z
        .string()
        .regex(/^\d+$/, "Klíč v `poznamky` musí být číslo nálezu"),
      z.string(),
    ),
    stavy: z.object(stavyShape).strict(),
  })
  .strict();

export type LokaceStavyPoznamky = z.infer<typeof lokaceStavyPoznamkySchema>;

/** The on-disk filename. The file lives at
 *  `${ADMIN_ROOTS.meta}/${LOKACE_STAVY_POZNAMKY_FILENAME}`. */
export const LOKACE_STAVY_POZNAMKY_FILENAME = "LokaceStavyPoznamky.json";
