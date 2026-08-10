/**
 * The 30 000 collage — geometry and selection, no pixels.
 *
 * A landing page at `/d/<token>` can carry a background built from the
 * collection's own crops. Everything here is pure so the layout can be
 * tested without images: the compositing lives in
 * `scripts/generate-collage.ts`, which runs on the box where the crops
 * actually are.
 */

/** The four backgrounds that get generated. `OFF` is not one of them —
 *  it is a campaign setting, see `CollageMode`. */
export const COLLAGE_VARIANTS = [
  "MOSAIC",
  "CLOVER",
  "N30000",
  "SCATTER",
  "LOGO",
  "SMILEY",
] as const;
export type CollageVariant = (typeof COLLAGE_VARIANTS)[number];

export const COLLAGE_VARIANT_LABEL: Record<CollageVariant, string> = {
  MOSAIC: "Mozaika",
  CLOVER: "Čtyřlístek z ořezů",
  N30000: "Číslo 30 000",
  SCATTER: "Rozptýlená vrstva",
  LOGO: "Kreslený čtyřlístek webu",
  SMILEY: "Smajlík",
};

/** The shaped variants that take their outline from a picture in
 *  `public/` rather than from generated SVG. Kept here so the generator
 *  and the admin agree on which files matter. */
export const COLLAGE_IMAGE_MASKS: Partial<Record<CollageVariant, string>> = {
  LOGO: "public/clover.png",
  SMILEY: "public/safronus-face.png",
};

/** How a wave decides which background a card gets. */
export const COLLAGE_MODES = [
  "OFF",
  "FIXED",
  "BY_FIND",
  "RANDOM",
  "DAILY",
] as const;
export type CollageMode = (typeof COLLAGE_MODES)[number];

export const COLLAGE_MODE_LABEL: Record<CollageMode, string> = {
  OFF: "Bez pozadí",
  FIXED: "Jedna zvolená",
  BY_FIND: "Podle čísla nálezu",
  RANDOM: "Náhodně při každém načtení",
  DAILY: "Rotace po dnech",
};

/**
 * Which background this card shows, or null for none.
 *
 * `BY_FIND` is the one worth explaining: it keys off the find number, so
 * a given card always looks the same. That is what makes it cacheable —
 * and it is also the nicer property in the field, where two people can
 * hold two cards and see that they differ.
 *
 * `RANDOM` takes `roll` from the caller rather than calling Math.random
 * itself, so this stays pure and the route decides where the randomness
 * comes from.
 */
export function pickCollageVariant(opts: {
  mode: CollageMode;
  /** Used by FIXED. */
  fixed: CollageVariant;
  /** Used by BY_FIND. */
  findId: number;
  /** Days since the epoch, used by DAILY. */
  dayIndex?: number;
  /** [0,1), used by RANDOM. */
  roll?: number;
}): CollageVariant | null {
  const n = COLLAGE_VARIANTS.length;
  switch (opts.mode) {
    case "OFF":
      return null;
    case "FIXED":
      return opts.fixed;
    case "BY_FIND":
      // Hashed, not `id % 4`. A wave is a run of consecutive ids, so any
      // plain modulo — and any multiply-then-modulo, which is the same
      // thing in disguise — deals them out in a strict repeating cycle:
      // the four cards you print next to each other come out 1,2,3,4,
      // 1,2,3,4. The hash breaks the correlation between neighbours while
      // staying a pure function of the number.
      return COLLAGE_VARIANTS[hash32(opts.findId) % n]!;
    case "DAILY":
      return COLLAGE_VARIANTS[Math.abs(opts.dayIndex ?? 0) % n]!;
    case "RANDOM":
      return COLLAGE_VARIANTS[
        Math.min(n - 1, Math.floor((opts.roll ?? 0) * n))
      ]!;
  }
}

/** Integer avalanche (the murmur3 finalizer). Two ids one apart give two
 *  unrelated outputs, which is the whole reason it's here. */
function hash32(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * Grid that holds at least `tiles` cells at roughly `aspect` (w/h).
 *
 * Solves cols/rows = aspect with cols*rows >= tiles, then nudges cols up
 * until the rows needed actually fit. Returns whole cells only — a
 * fractional column is not a thing you can put a photo in.
 */
export function gridFor(
  tiles: number,
  aspect: number,
): { cols: number; rows: number } {
  if (tiles <= 0) return { cols: 0, rows: 0 };
  let cols = Math.max(1, Math.round(Math.sqrt(tiles * aspect)));
  let rows = Math.ceil(tiles / cols);
  // Rounding can leave the grid a shade too tall; widening by one column
  // is cheaper than leaving a mostly-empty last row.
  while (cols * rows < tiles) {
    cols += 1;
    rows = Math.ceil(tiles / cols);
  }
  return { cols, rows };
}

/**
 * Grid resolution at which a mask holds at least `tiles` cells.
 *
 * The point of the shaped variants is that the crops *form* the shape,
 * so the grid has to be fine enough that the clover (or the number) has
 * room for all of them. Binary search on the column count, asking the
 * caller how many cells the mask lights up at each resolution — which
 * keeps the pixel sampling out of here.
 *
 * Returns null when even `maxCols` isn't enough; the caller then knows to
 * place what fits and say so rather than silently dropping the rest.
 */
export function fitGridToMask(
  tiles: number,
  aspect: number,
  countOn: (cols: number, rows: number) => number,
  maxCols = 1200,
): { cols: number; rows: number } | null {
  if (tiles <= 0) return { cols: 0, rows: 0 };
  const rowsFor = (cols: number) => Math.max(1, Math.round(cols / aspect));
  if (countOn(maxCols, rowsFor(maxCols)) < tiles) return null;

  let lo = 1;
  let hi = maxCols;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (countOn(mid, rowsFor(mid)) >= tiles) hi = mid;
    else lo = mid + 1;
  }
  return { cols: lo, rows: rowsFor(lo) };
}

/** One crop dropped onto the scatter layer. */
export interface ScatterPlacement {
  /** Top-left, in pixels. May be negative — tiles bleed off the edge on
   *  purpose, so the layer doesn't read as a rectangle of stickers. */
  x: number;
  y: number;
  size: number;
  /** Degrees. */
  rotate: number;
  /** 0..1 */
  opacity: number;
}

/**
 * Deterministic PRNG (mulberry32).
 *
 * Deterministic because the collage is generated on the server and then
 * cached: re-running the generator must produce the same picture, or
 * every deploy would silently reshuffle the background.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Where the scatter variant puts its crops.
 *
 * Fewer, larger, overlapping tiles rather than a grid — this is the one
 * meant to sit behind text, so it stays sparse and leans transparent.
 * Tiles nearest the edges are faintest, which is what keeps the middle of
 * the page readable without a separate vignette.
 */
export function scatterPlan(
  count: number,
  width: number,
  height: number,
  rng: () => number,
): ScatterPlacement[] {
  const out: ScatterPlacement[] = [];
  const base = Math.min(width, height);
  for (let i = 0; i < count; i++) {
    const size = Math.round(base * (0.04 + rng() * 0.08));
    // Left edge runs from -size/2 to width-size/2, so a tile may be cut
    // by the edge but never lands entirely off-canvas — a tile nobody can
    // see is a tile that cost compositing time for nothing.
    const x = Math.round(rng() * width - size / 2);
    const y = Math.round(rng() * height - size / 2);
    const cx = x + size / 2;
    const cy = y + size / 2;
    // 0 at the centre, 1 at the far corner.
    const dist = Math.min(
      1,
      Math.hypot(cx - width / 2, cy - height / 2) /
        Math.hypot(width / 2, height / 2),
    );
    out.push({
      x,
      y,
      size,
      rotate: Math.round(rng() * 360),
      opacity: Number((0.28 + 0.5 * dist * (0.6 + rng() * 0.4)).toFixed(3)),
    });
  }
  return out;
}

/** The site's own clover — the favicon's four ellipses and stem, so the
 *  shaped variant is the same plant the rest of the site draws. Rendered
 *  white on black because it is used as a mask. */
export function cloverMaskSvg(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
  <rect width="100" height="100" fill="#000"/>
  <g fill="#fff">
    <ellipse cx="35" cy="35" rx="18" ry="22" transform="rotate(-45 35 35)"/>
    <ellipse cx="65" cy="35" rx="18" ry="22" transform="rotate(45 65 35)"/>
    <ellipse cx="35" cy="65" rx="18" ry="22" transform="rotate(45 35 65)"/>
    <ellipse cx="65" cy="65" rx="18" ry="22" transform="rotate(-45 65 65)"/>
  </g>
  <rect x="47" y="65" width="6" height="25" rx="2" fill="#fff"/>
</svg>`;
}

/** "30 000" as a mask. `sans-serif` resolves through fontconfig on the
 *  box (DejaVu Sans) — the SVG rasterizer has no web fonts, same rule the
 *  QR generator lives by. */
export function numberMaskSvg(
  width: number,
  height: number,
  text = "30 000",
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1000 320">
  <rect width="1000" height="320" fill="#000"/>
  <text x="500" y="230" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="260" fill="#fff">${text}</text>
</svg>`;
}
