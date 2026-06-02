import { describe, it, expect } from "vitest";
import {
  lokaceStavyPoznamkyMergeInputSchema,
  lokaceStavyPoznamkySchema,
} from "./jsonSchema";

describe("lokaceStavyPoznamkyMergeInputSchema (bulk-merge input)", () => {
  it("accepts a partial file with only the lokace section + a metadata block", () => {
    // The exact shape the PDF exporter produces — only `lokace`, plus a
    // `metadata` block. The strict whole-file schema rejects this; the
    // merge-input schema must accept it.
    const input = {
      lokace: {
        "1": ["20131-20137"],
        "126": ["20122-20130"],
        "2": ["20110-20121"],
      },
      metadata: {
        export_source: "PDF Generator Window (Delta Clipboard)",
        last_export: "2026-06-02T08:16:38.229053",
        version: "1.0",
      },
    };
    const r = lokaceStavyPoznamkyMergeInputSchema.safeParse(input);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.lokace).toEqual({
        "1": ["20131-20137"],
        "126": ["20122-20130"],
        "2": ["20110-20121"],
      });
      // sections you didn't paste stay absent (merge leaves them alone)
      expect(r.data.anonymizace).toBeUndefined();
      expect(r.data.stavy).toBeUndefined();
      expect(r.data.poznamky).toBeUndefined();
    }
  });

  it("rejects the same metadata block under the strict whole-file schema", () => {
    // Documents WHY the lenient variant exists.
    const r = lokaceStavyPoznamkySchema.safeParse({
      lokace: { "1": ["1"] },
      metadata: { version: "1.0" },
    });
    expect(r.success).toBe(false);
  });

  it("accepts an empty object (nothing to merge)", () => {
    expect(lokaceStavyPoznamkyMergeInputSchema.safeParse({}).success).toBe(
      true,
    );
  });

  it("accepts several sections at once", () => {
    const r = lokaceStavyPoznamkyMergeInputSchema.safeParse({
      anonymizace: { ANONYMIZOVANE: ["6-7"] },
      stavy: { DAROVANY: ["100"] },
      poznamky: { "100": "dar" },
    });
    expect(r.success).toBe(true);
  });

  it("still rejects an invalid range string", () => {
    const r = lokaceStavyPoznamkyMergeInputSchema.safeParse({
      lokace: { "1": ["35-15"] },
    });
    expect(r.success).toBe(false);
  });
});
