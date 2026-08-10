import { describe, expect, it } from "vitest";
import {
  COLLAGE_VARIANTS,
  fitGridToMask,
  gridFor,
  makeRng,
  pickCollageVariant,
  scatterPlan,
  type CollageVariant,
} from "./collage";

describe("pickCollageVariant", () => {
  const fixed: CollageVariant = "SCATTER";

  it("shows nothing when the wave has backgrounds off", () => {
    expect(
      pickCollageVariant({ mode: "OFF", fixed, findId: 30042 }),
    ).toBeNull();
  });

  it("returns the chosen one in FIXED", () => {
    expect(pickCollageVariant({ mode: "FIXED", fixed, findId: 30042 })).toBe(
      "SCATTER",
    );
  });

  it("is stable for a given find in BY_FIND", () => {
    const a = pickCollageVariant({ mode: "BY_FIND", fixed, findId: 30042 });
    const b = pickCollageVariant({ mode: "BY_FIND", fixed, findId: 30042 });
    expect(a).toBe(b);
    expect(COLLAGE_VARIANTS).toContain(a!);
  });

  it("does not hand consecutive finds a repeating cycle", () => {
    // Why the hash: a wave is consecutive ids, so any plain modulo deals
    // neighbours out in lockstep — the cards sitting together in one box
    // would come out in a visible repeating pattern.
    const ids = Array.from({ length: 8 }, (_, i) => 30001 + i);
    const picks = ids.map((findId) =>
      pickCollageVariant({ mode: "BY_FIND", fixed, findId }),
    );
    expect(picks.slice(0, 4)).not.toEqual(picks.slice(4, 8));
  });

  it("covers every variant across a wave", () => {
    const seen = new Set(
      Array.from({ length: 111 }, (_, i) =>
        pickCollageVariant({ mode: "BY_FIND", fixed, findId: 30001 + i }),
      ),
    );
    expect(seen.size).toBe(COLLAGE_VARIANTS.length);
  });

  it("changes with the day in DAILY", () => {
    const a = pickCollageVariant({
      mode: "DAILY",
      fixed,
      findId: 1,
      dayIndex: 20000,
    });
    const b = pickCollageVariant({
      mode: "DAILY",
      fixed,
      findId: 1,
      dayIndex: 20001,
    });
    expect(a).not.toBe(b);
  });

  it("keeps RANDOM inside the list at both ends of the roll", () => {
    expect(
      pickCollageVariant({ mode: "RANDOM", fixed, findId: 1, roll: 0 }),
    ).toBe(COLLAGE_VARIANTS[0]);
    // 0.999… must not fall off the end.
    expect(
      pickCollageVariant({
        mode: "RANDOM",
        fixed,
        findId: 1,
        roll: 0.99999999,
      }),
    ).toBe(COLLAGE_VARIANTS[COLLAGE_VARIANTS.length - 1]);
  });
});

describe("gridFor", () => {
  it("holds every tile", () => {
    for (const n of [1, 7, 100, 1234, 30000]) {
      const { cols, rows } = gridFor(n, 4 / 3);
      expect(cols * rows).toBeGreaterThanOrEqual(n);
    }
  });

  it("lands near the requested aspect", () => {
    const { cols, rows } = gridFor(30000, 4 / 3);
    expect(cols / rows).toBeGreaterThan(1.2);
    expect(cols / rows).toBeLessThan(1.45);
  });

  it("wastes at most one row", () => {
    const { cols, rows } = gridFor(30000, 4 / 3);
    expect((cols * rows - 30000) / cols).toBeLessThanOrEqual(1);
  });

  it("handles an empty collection", () => {
    expect(gridFor(0, 4 / 3)).toEqual({ cols: 0, rows: 0 });
  });
});

describe("fitGridToMask", () => {
  // Stand-in mask that lights up a quarter of its cells.
  const quarter = (cols: number, rows: number) =>
    Math.floor((cols * rows) / 4);

  it("finds the smallest grid that fits the tiles", async () => {
    const got = await fitGridToMask(1000, 4 / 3, quarter);
    expect(got).not.toBeNull();
    expect(quarter(got!.cols, got!.rows)).toBeGreaterThanOrEqual(1000);
    // ...and one column narrower would not have been enough.
    const rowsFor = (c: number) => Math.max(1, Math.round(c / (4 / 3)));
    expect(quarter(got!.cols - 1, rowsFor(got!.cols - 1))).toBeLessThan(1000);
  });

  it("returns null rather than quietly dropping crops", async () => {
    // A mask with almost no room, asked to hold 30 000.
    const sliver = () => 3;
    await expect(fitGridToMask(30000, 4 / 3, sliver)).resolves.toBeNull();
  });

  it("asks the counter about the resolution it actually returns", async () => {
    // The bug this guards: answering from a nearby HIGHER resolution
    // overstates the room, and the search stops at a grid that cannot
    // hold the tiles. On the first real run the clover reported success
    // while placing 24 057 of 30 000 crops.
    const asked: number[] = [];
    const got = await fitGridToMask(1000, 4 / 3, (cols, rows) => {
      asked.push(cols);
      return Math.floor((cols * rows) / 4);
    });
    expect(asked).toContain(got!.cols);
    expect(quarter(got!.cols, got!.rows)).toBeGreaterThanOrEqual(1000);
  });

  it("accepts an async counter", async () => {
    const got = await fitGridToMask(1000, 4 / 3, async (c, r) =>
      Promise.resolve(quarter(c, r)),
    );
    expect(quarter(got!.cols, got!.rows)).toBeGreaterThanOrEqual(1000);
  });
});

describe("scatterPlan", () => {
  const W = 2400;
  const H = 1800;

  it("is reproducible from the seed", () => {
    // A rebuild must produce the same picture — otherwise every deploy
    // reshuffles the background under people who already saw it.
    expect(scatterPlan(50, W, H, makeRng(42))).toEqual(
      scatterPlan(50, W, H, makeRng(42)),
    );
  });

  it("differs with a different seed", () => {
    expect(scatterPlan(50, W, H, makeRng(1))).not.toEqual(
      scatterPlan(50, W, H, makeRng(2)),
    );
  });

  it("keeps every tile at least partly on the canvas", () => {
    for (const p of scatterPlan(500, W, H, makeRng(7))) {
      expect(p.x + p.size).toBeGreaterThan(0);
      expect(p.y + p.size).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(W);
      expect(p.y).toBeLessThan(H);
    }
  });

  it("produces usable sizes and opacities", () => {
    for (const p of scatterPlan(500, W, H, makeRng(7))) {
      expect(p.size).toBeGreaterThan(0);
      expect(p.opacity).toBeGreaterThan(0);
      expect(p.opacity).toBeLessThanOrEqual(1);
      expect(p.rotate).toBeGreaterThanOrEqual(0);
      expect(p.rotate).toBeLessThanOrEqual(360);
    }
  });

  it("fades towards the edges, so the middle stays readable", () => {
    const plan = scatterPlan(800, W, H, makeRng(3));
    const centreish = plan.filter(
      (p) => Math.hypot(p.x + p.size / 2 - W / 2, p.y + p.size / 2 - H / 2) < 400,
    );
    const outer = plan.filter(
      (p) => Math.hypot(p.x + p.size / 2 - W / 2, p.y + p.size / 2 - H / 2) > 1000,
    );
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(centreish.map((p) => p.opacity))).toBeLessThan(
      mean(outer.map((p) => p.opacity)),
    );
  });
});
