/**
 * Where every card lands on the print sheet — the geometry, with no
 * drawing and no DOM.
 *
 * Pulled out of the dialog because this is the part that can be quietly
 * wrong: a wrapped row, a page break that forgets the free space, or a
 * back side mirrored across the wrong axis all produce a PDF that LOOKS
 * fine on screen and only fails after somebody has printed, flipped and
 * cut a hundred cards. Pure functions, so a test can check them.
 *
 * All measurements are millimetres, matching jsPDF's `unit: "mm"`.
 */

export type CutStyle = "corners" | "box" | "none";
/** Which edge the printer flips the paper over when printing both sides. */
export type FlipAxis = "long" | "short";
export type BackPos = "top" | "bottom";

export const A4_W_MM = 210;
export const A4_H_MM = 297;
/** Printers cannot reach the paper edge; keep the cards inside this. */
export const PAGE_MARGIN_MM = 8;
/** Distance from the cut edge to the back text, before the fine offset. */
export const BACK_EDGE_MM = 2;
/** Left and right breathing room for the back text inside the card. */
export const BACK_SIDE_MM = 2;
/**
 * Rendered line height as a multiple of the font size.
 *
 * The back text is drawn into a canvas whose box is this much taller than
 * the glyphs — headroom for descenders and for emoji, which overshoot the
 * nominal em box in most fonts. The preview uses the same number so what
 * is on screen sits where the print will.
 */
export const BACK_LINE_FACTOR = 1.35;

export interface BackSide {
  text: string;
  pos: BackPos;
  /** Fine adjustment, positive = further down the page. */
  offsetMm: number;
  sizeMm: number;
  flip: FlipAxis;
}

export interface SheetOpts {
  gapMm: number;
  cut: CutStyle;
  numbers: boolean;
  /** Blank strip cut out together with the card. */
  padTopMm: number;
  padBottomMm: number;
  back: BackSide | null;
}

/** The little a card has to know about itself to be placed. */
export interface PrintCard {
  findId: number;
  sizeCm: number;
  /** height ÷ width of the rendered code, including its captions. */
  aspect: number;
}

export interface Placement<T extends PrintCard = PrintCard> {
  card: T;
  x: number;
  y: number;
  w: number;
  /** The card itself. */
  h: number;
  /** Card plus the free space above and below — what gets cut out. */
  cellH: number;
}

export class CardTooBigError extends Error {}

/**
 * Row-packing layout, so mixed card sizes still tile sensibly.
 *
 * A card may override the wave's print size, so a row is as tall as its
 * tallest cell and wraps when the next card no longer fits. With one size
 * throughout — the normal case — this degenerates into a plain grid.
 */
export function planSheet<T extends PrintCard>(
  cards: readonly T[],
  opts: SheetOpts,
): Placement<T>[][] {
  const usableW = A4_W_MM - 2 * PAGE_MARGIN_MM;
  const usableH = A4_H_MM - 2 * PAGE_MARGIN_MM;
  const gap = opts.gapMm;

  const pages: Placement<T>[][] = [[]];
  let x = PAGE_MARGIN_MM;
  let y = PAGE_MARGIN_MM;
  let rowH = 0;
  let firstOnPage = true;

  for (const card of cards) {
    const w = card.sizeCm * 10;
    const h = w * card.aspect;
    const cellH = h + opts.padTopMm + opts.padBottomMm;

    // A single card taller or wider than the page is a configuration
    // mistake, not something to silently crop — say so.
    if (w > usableW || cellH > usableH) {
      throw new CardTooBigError(
        `🍀 #${card.findId}: ${card.sizeCm} cm${
          opts.padTopMm + opts.padBottomMm > 0 ? " s volným místem" : ""
        } se na A4 nevejde, zmenši velikost tisku.`,
      );
    }

    if (!firstOnPage && x + w > PAGE_MARGIN_MM + usableW + 0.01) {
      x = PAGE_MARGIN_MM; // wrap to the next row
      y += rowH + gap;
      rowH = 0;
    }
    if (y + cellH > PAGE_MARGIN_MM + usableH + 0.01) {
      pages.push([]);
      x = PAGE_MARGIN_MM;
      y = PAGE_MARGIN_MM;
      rowH = 0;
      // `firstOnPage` deliberately stays as it is: this card is placed
      // immediately below, which sets it false anyway. The flag only
      // guards the very first card of the batch against a wrap it cannot
      // need.
    }

    pages[pages.length - 1]!.push({ card, x, y, w, h, cellH });
    rowH = Math.max(rowH, cellH);
    x += w + gap;
    firstOnPage = false;
  }

  return pages;
}

/**
 * The same cell as seen from the back of the paper.
 *
 * Long edge — the usual duplex setting — turns the sheet left to right, so
 * x flips and y stays; short edge turns it top to bottom, so y flips.
 * Getting this backwards puts every card's text on its neighbour, which is
 * only visible after the sheet is printed on both sides.
 */
export function mirrorCell(
  p: Pick<Placement, "x" | "y" | "w" | "cellH">,
  flip: FlipAxis,
): { x: number; y: number } {
  return {
    x: flip === "long" ? A4_W_MM - (p.x + p.w) : p.x,
    y: flip === "short" ? A4_H_MM - (p.y + p.cellH) : p.y,
  };
}

/**
 * Where the back text image goes inside a mirrored cell.
 *
 * Scaled down (never up) to fit the card's width, centred, and pushed to
 * the chosen edge plus the operator's fine offset — no printer lands the
 * second pass on the first to a tenth of a millimetre.
 */
export function backTextRect(
  p: Pick<Placement, "x" | "y" | "w" | "cellH">,
  image: { wMm: number; hMm: number },
  back: BackSide,
): { x: number; y: number; w: number; h: number } {
  const cell = mirrorCell(p, back.flip);
  const maxW = Math.max(1, p.w - 2 * BACK_SIDE_MM);
  const w = Math.min(image.wMm, maxW);
  const h = image.hMm * (w / image.wMm);
  return {
    x: cell.x + (p.w - w) / 2,
    y: backTextTop(cell.y, p.cellH, h, back),
    w,
    h,
  };
}

/**
 * Distance from the top of the page (or of anything else `cellTop` is
 * measured from) to the top of the back text.
 *
 * Shared with the on-screen preview, which has no image to measure and
 * passes a cell-relative zero — so the two cannot drift apart.
 */
export function backTextTop(
  cellTop: number,
  cellH: number,
  textH: number,
  back: BackSide,
): number {
  return back.pos === "top"
    ? cellTop + BACK_EDGE_MM + back.offsetMm
    : cellTop + cellH - BACK_EDGE_MM - textH + back.offsetMm;
}
