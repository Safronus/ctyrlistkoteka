import { describe, expect, it } from "vitest";
import { formatDuration, lensRound, MAX_ROUND, meadowRound, prng, summarizeTimes } from "./hunt";

describe("prng", () => {
  it("is reproducible from the seed and stays in [0, 1)", () => {
    const a = prng(42), b = prng(42);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
  });
});

describe("meadowRound", () => {
  it("starts small and easy: 8×6, three greens, no decoys", () => {
    const r = meadowRound(1, 7);
    expect([r.columns, r.rows, r.cells.length]).toEqual([8, 6, 48]);
    expect(r.cells.some((c) => c.bud)).toBe(false);
    expect(r.lucky).toBeGreaterThanOrEqual(0);
    expect(r.lucky).toBeLessThan(48);
  });

  it("gets harder every round and caps at 12×10", () => {
    const sizes = [1, 2, 3, 4, 5, 6, 7, 8, 20].map((n) => meadowRound(n, 7).cells.length);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]!);
    expect(meadowRound(MAX_ROUND, 7).columns).toBeLessThanOrEqual(12);
    expect(meadowRound(99, 7)).toEqual(meadowRound(MAX_ROUND, 7));
  });

  it("brings decoys from round 3 — never on the four-leaf — and one green", () => {
    const r = meadowRound(5, 123);
    expect(r.cells.some((c) => c.bud)).toBe(true);
    expect(r.cells[r.lucky]!.bud).toBe(false);
    expect(new Set(r.cells.map((c) => c.shade)).size).toBe(1);
  });

  it("keeps round 1 tidy, then lets clovers wander and overlap", () => {
    const one = meadowRound(1, 3);
    expect(one.cells.every((c) => c.dx === 0 && c.dy === 0 && c.scale === 1)).toBe(true);
    const two = meadowRound(2, 3);
    expect(two.cells.some((c) => c.dx !== 0 || c.dy !== 0)).toBe(true);
    expect(two.cells.every((c) => c.scale === 1)).toBe(true);
    const six = meadowRound(6, 3);
    expect(Math.max(...six.cells.map((c) => c.scale))).toBeGreaterThan(1.2);
    for (const c of meadowRound(MAX_ROUND, 3).cells) {
      expect(Math.abs(c.dx)).toBeLessThanOrEqual(35);
      expect(c.scale).toBeLessThanOrEqual(1.6);
    }
  });

  it("puts the four-leaf in different places for different seeds", () => {
    const spots = new Set(Array.from({ length: 40 }, (_, s) => meadowRound(1, s).lucky));
    expect(spots.size).toBeGreaterThan(20);
  });
});

describe("lensRound", () => {
  it("adds clovers, shrinks the lens and blurs more each round, within bounds", () => {
    const one = lensRound(1, 9), four = lensRound(4, 9), last = lensRound(50, 9);
    expect([one.clovers.length, one.lensRadius, one.blur]).toEqual([60, 64, 5]);
    expect(four.clovers.length).toBeGreaterThan(one.clovers.length);
    expect(four.lensRadius).toBeLessThan(one.lensRadius);
    expect(last.lensRadius).toBeGreaterThanOrEqual(40);
    expect(last.blur).toBeLessThanOrEqual(10);
    expect(last.clovers.length).toBeLessThanOrEqual(200);
  });

  it("keeps the four-leaf off the edges and never a decoy", () => {
    for (let s = 0; s < 50; s++) {
      const { lucky } = lensRound(6, s);
      expect(lucky.bud).toBe(false);
      for (const v of [lucky.x, lucky.y]) {
        expect(v).toBeGreaterThanOrEqual(8);
        expect(v).toBeLessThanOrEqual(92);
      }
    }
  });
});

describe("summarizeTimes", () => {
  it("is empty before the first round", () => {
    expect(summarizeTimes([])).toEqual({ last: null, best: null, average: null, newRecord: false });
  });

  it("tracks last, best, average — and a record only when an earlier round is beaten", () => {
    expect(summarizeTimes([9000])).toMatchObject({ last: 9000, best: 9000, newRecord: false });
    expect(summarizeTimes([9000, 12000])).toMatchObject({ best: 9000, average: 10500, newRecord: false });
    expect(summarizeTimes([9000, 12000, 7000])).toMatchObject({ last: 7000, best: 7000, newRecord: true });
  });
});

describe("formatDuration", () => {
  it("writes seconds with tenths in the locale's decimal sign", () => {
    expect(formatDuration(12345, "cs")).toBe("12,3 s");
    expect(formatDuration(12345, "en")).toBe("12.3 s");
    expect(formatDuration(0, "en")).toBe("0.0 s");
  });

  it("switches to minutes past a minute", () => {
    expect(formatDuration(65000, "cs")).toBe("1:05,0");
    expect(formatDuration(125400, "en")).toBe("2:05.4");
  });
});
