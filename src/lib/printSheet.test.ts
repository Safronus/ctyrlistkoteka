import { describe, expect, it } from "vitest";
import {
  A4_H_MM,
  A4_W_MM,
  BACK_EDGE_MM,
  CardTooBigError,
  PAGE_MARGIN_MM,
  backTextRect,
  mirrorCell,
  planSheet,
  type SheetOpts,
} from "./printSheet";

/**
 * The print sheet is the one export that costs paper, ink and an evening
 * with scissors to get wrong — and a mistake in it is invisible until
 * after all three. Hence tests on the geometry rather than on the PDF.
 */

const BASE: SheetOpts = {
  gapMm: 4,
  cut: "corners",
  numbers: false,
  padTopMm: 0,
  padBottomMm: 0,
  back: null,
};

/** A square-ish card of the wave's usual size. */
const card = (findId: number, sizeCm = 6.5, aspect = 1) => ({
  findId,
  sizeCm,
  aspect,
});

describe("planSheet", () => {
  it("fills a row before wrapping, and a page before breaking", () => {
    // 65 mm wide + 4 mm gap → two per 194 mm row; 69 mm per row → four
    // rows in 281 mm, so eight cards to a page.
    const pages = planSheet(
      Array.from({ length: 9 }, (_, i) => card(i + 1)),
      BASE,
    );
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(8);
    expect(pages[1]).toHaveLength(1);

    const [a, b, c] = pages[0]!;
    expect(a!.x).toBe(PAGE_MARGIN_MM);
    expect(b!.x).toBeCloseTo(PAGE_MARGIN_MM + 65 + 4);
    expect(a!.y).toBe(PAGE_MARGIN_MM);
    // Third card wraps to a new row, one card-height + gap lower.
    expect(c!.x).toBe(PAGE_MARGIN_MM);
    expect(c!.y).toBeCloseTo(PAGE_MARGIN_MM + 65 + 4);
    // Every card stays inside the printable area.
    for (const p of pages.flat()) {
      expect(p.x + p.w).toBeLessThanOrEqual(A4_W_MM - PAGE_MARGIN_MM + 0.01);
      expect(p.y + p.cellH).toBeLessThanOrEqual(A4_H_MM - PAGE_MARGIN_MM + 0.01);
    }
  });

  it("counts the free space as part of the cell, not as a bonus", () => {
    const opts = { ...BASE, padTopMm: 12, padBottomMm: 6 };
    const eight = Array.from({ length: 8 }, (_, i) => card(i + 1));
    const pages = planSheet(eight, opts);
    const p = pages[0]![0]!;
    expect(p.h).toBe(65);
    expect(p.cellH).toBe(65 + 12 + 6);
    // 83 mm cells: three rows fit in 281 mm instead of four, so eight
    // cards need two pages — the same eight that fit on one without it.
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(6);
    expect(planSheet(eight, BASE)).toHaveLength(1);
  });

  it("keeps rows as tall as their tallest card", () => {
    const pages = planSheet([card(1, 4), card(2, 4, 2)], BASE);
    const [a, b] = pages[0]!;
    expect(a!.y).toBe(b!.y);
    // 40 mm cards at no gap: four to a row. The fifth wraps below the
    // TALLEST card of the first row, not below its own height.
    const row = planSheet(
      [card(1, 4), card(2, 4, 2), card(3, 4), card(4, 4), card(5, 4)],
      { ...BASE, gapMm: 0 },
    );
    expect(row[0]![4]!.y).toBeCloseTo(PAGE_MARGIN_MM + 80);
  });

  it("refuses a card that cannot fit rather than cropping it", () => {
    // Wider than the printable area…
    expect(() => planSheet([card(30013, 21)], BASE)).toThrow(CardTooBigError);
    // …and taller than it.
    expect(() => planSheet([card(30013, 6.5, 5)], BASE)).toThrow(
      CardTooBigError,
    );
    expect(() => planSheet([card(30013, 21)], BASE)).toThrow(/nevejde/);
  });

  it("says the free space is what pushed a card over the edge", () => {
    const tall = { ...BASE, padTopMm: 30, padBottomMm: 30 };
    // 227.5 mm of card fits; 227.5 + 60 of free space does not.
    expect(() => planSheet([card(1, 6.5, 3.5)], tall)).toThrow(
      /s volným místem/,
    );
    expect(() => planSheet([card(1, 6.5, 3.5)], BASE)).not.toThrow();
  });

  it("returns one empty page for no cards", () => {
    expect(planSheet([], BASE)).toEqual([[]]);
  });
});

describe("mirrorCell", () => {
  const p = { x: PAGE_MARGIN_MM, y: 20, w: 65, cellH: 80 };

  it("flips x for a long-edge flip, the usual duplex setting", () => {
    expect(mirrorCell(p, "long")).toEqual({
      x: A4_W_MM - (PAGE_MARGIN_MM + 65),
      y: 20,
    });
  });

  it("flips y for a short-edge flip", () => {
    expect(mirrorCell(p, "short")).toEqual({
      x: PAGE_MARGIN_MM,
      y: A4_H_MM - (20 + 80),
    });
  });

  it("is its own inverse — the back of the back is the front", () => {
    for (const flip of ["long", "short"] as const) {
      const once = mirrorCell(p, flip);
      const twice = mirrorCell({ ...p, ...once }, flip);
      expect(twice.x).toBeCloseTo(p.x);
      expect(twice.y).toBeCloseTo(p.y);
    }
  });

  it("keeps a centred card centred", () => {
    const centred = { x: (A4_W_MM - 65) / 2, y: 20, w: 65, cellH: 80 };
    expect(mirrorCell(centred, "long").x).toBeCloseTo(centred.x);
  });
});

describe("backTextRect", () => {
  const p = { x: PAGE_MARGIN_MM, y: 20, w: 65, cellH: 80 };
  const back = {
    text: "ctyrlistkoteka.cz",
    pos: "bottom" as const,
    offsetMm: 0,
    sizeMm: 3,
    flip: "long" as const,
  };
  const image = { wMm: 30, hMm: 4 };

  it("centres the text on the mirrored cell", () => {
    const r = backTextRect(p, image, back);
    const cell = mirrorCell(p, "long");
    expect(r.x + r.w / 2).toBeCloseTo(cell.x + p.w / 2);
  });

  it("sits at the chosen edge", () => {
    const bottom = backTextRect(p, image, back);
    expect(bottom.y + bottom.h).toBeCloseTo(p.y + p.cellH - BACK_EDGE_MM);
    const top = backTextRect(p, image, { ...back, pos: "top" });
    expect(top.y).toBeCloseTo(p.y + BACK_EDGE_MM);
  });

  it("moves with the fine offset, in millimetres, downwards for positive", () => {
    const zero = backTextRect(p, image, back);
    const nudged = backTextRect(p, image, { ...back, offsetMm: 1.5 });
    expect(nudged.y - zero.y).toBeCloseTo(1.5);
  });

  it("shrinks a long text to the card, keeping its proportions", () => {
    const wide = backTextRect(p, { wMm: 200, hMm: 20 }, back);
    expect(wide.w).toBeCloseTo(65 - 4);
    expect(wide.h / wide.w).toBeCloseTo(20 / 200);
    expect(wide.x).toBeGreaterThanOrEqual(mirrorCell(p, "long").x);
  });

  it("never blows a short text up to fill the card", () => {
    const small = backTextRect(p, { wMm: 10, hMm: 3 }, back);
    expect(small.w).toBe(10);
  });
});
