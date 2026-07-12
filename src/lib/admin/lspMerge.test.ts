import { describe, expect, it } from "vitest";
import { computeWholeFileMerge, mergeRanges } from "./lspMerge";

describe("mergeRanges", () => {
  it("unions ranges and splits added vs already-present", () => {
    const r = mergeRanges(["10-12"], ["11", "13", "15"]);
    expect(r.added).toEqual([13, 15]);
    expect(r.alreadyPresent).toEqual([11]);
    expect(r.merged).toEqual(["10-13", "15"]);
  });
});

describe("computeWholeFileMerge (dry-run shared by editor + import)", () => {
  it("reports new lokace keys + added ids against an existing file", () => {
    const existing = { lokace: { "32": ["27270-27271"] } };
    const incoming = {
      anonymizace: {},
      lokace: { "201": ["27273"], "30": ["27274-27445"], "32": ["27272"] },
      poznamky: {},
      stavy: {},
    };
    const { sections, conflicts, totalChanges } = computeWholeFileMerge(
      incoming,
      existing,
    );
    expect(conflicts).toEqual([]);
    // "201" and "30" are brand-new location keys; "32" already existed.
    expect(sections.lokace.addedKeys.sort()).toEqual(["201", "30"]);
    // 27272 (into 32), 27273 (201), 27274..27445 (30) are all new ids.
    expect(sections.lokace.addedIds).toContain(27272);
    expect(sections.lokace.addedIds).toContain(27273);
    expect(sections.lokace.addedIds).not.toContain(27270); // already present
    expect(totalChanges).toBeGreaterThan(0);
  });

  it("flags poznamky conflicts (same key, different text) and aborts-worthy", () => {
    const existing = { poznamky: { "100": "old" } };
    const incoming = { poznamky: { "100": "new", "101": "fresh" } };
    const { sections, conflicts } = computeWholeFileMerge(incoming, existing);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.path).toBe('poznamky["100"]');
    expect(sections.poznamky.addedKeys).toEqual(["101"]);
  });

  it("totalChanges is 0 when the incoming adds nothing new", () => {
    const existing = { lokace: { "1": ["5"] }, poznamky: { "5": "x" } };
    const incoming = { lokace: { "1": ["5"] }, poznamky: { "5": "x" } };
    const { totalChanges, conflicts } = computeWholeFileMerge(incoming, existing);
    expect(conflicts).toEqual([]);
    expect(totalChanges).toBe(0);
  });
});
