import { describe, it, expect } from "vitest";
import { compactToRanges, parseRanges } from "./parseRanges";

describe("parseRanges", () => {
  it("expands a single range", () => {
    expect(parseRanges(["15-20"])).toEqual([15, 16, 17, 18, 19, 20]);
  });

  it("handles single numeric ids", () => {
    expect(parseRanges(["42", "7"])).toEqual([7, 42]);
  });

  it("mixes ranges and single ids, deduplicates, sorts", () => {
    expect(parseRanges(["10-12", "11", "14", "5-6"])).toEqual([
      5, 6, 10, 11, 12, 14,
    ]);
  });

  it("ignores empty and whitespace strings", () => {
    expect(parseRanges(["", "  ", "3"])).toEqual([3]);
  });

  it("returns [] on empty input", () => {
    expect(parseRanges([])).toEqual([]);
  });

  it("expands a range of length 1 (same start and end)", () => {
    expect(parseRanges(["5-5"])).toEqual([5]);
  });

  it("throws on malformed spec", () => {
    expect(() => parseRanges(["foo"])).toThrow(/Invalid range spec/);
    expect(() => parseRanges(["10-"])).toThrow(/Invalid range spec/);
    expect(() => parseRanges(["-5"])).toThrow(/Invalid range spec/);
    expect(() => parseRanges(["1-2-3"])).toThrow(/Invalid range spec/);
  });

  it("throws when range start > end", () => {
    expect(() => parseRanges(["20-15"])).toThrow(/start > end/);
  });

  it("matches the real sample from LokaceStavyPoznamky.sample.json", () => {
    // "stavy.DAROVANY": ["13602-13603", "14608"]
    expect(parseRanges(["13602-13603", "14608"])).toEqual([
      13602, 13603, 14608,
    ]);
  });
});

describe("compactToRanges", () => {
  it("returns [] for empty input", () => {
    expect(compactToRanges([])).toEqual([]);
  });

  it("emits a single id as a string", () => {
    expect(compactToRanges([42])).toEqual(["42"]);
  });

  it("collapses consecutive ids into ranges", () => {
    expect(compactToRanges([1, 2, 3])).toEqual(["1-3"]);
  });

  it("preserves gaps and mixes singletons with ranges", () => {
    expect(compactToRanges([1, 2, 3, 5, 7, 8, 9])).toEqual([
      "1-3",
      "5",
      "7-9",
    ]);
  });

  it("sorts unsorted input", () => {
    expect(compactToRanges([7, 1, 3, 2])).toEqual(["1-3", "7"]);
  });

  it("dedupes", () => {
    expect(compactToRanges([1, 2, 2, 3, 3, 3])).toEqual(["1-3"]);
  });

  it("round-trips through parseRanges", () => {
    const ids = parseRanges(["13602-13603", "14608", "1", "16945"]);
    expect(compactToRanges(ids)).toEqual([
      "1",
      "13602-13603",
      "14608",
      "16945",
    ]);
  });

  it("merges a newly added id into an adjacent range", () => {
    const ids = parseRanges(["13602-13603", "13604"]);
    expect(compactToRanges(ids)).toEqual(["13602-13604"]);
  });
});
