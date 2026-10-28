/**
 * Pure rules of the 404 clover hunt: how a round is laid out and how hard it
 * gets. No React, no DOM — the games render what this decides, and the
 * tests pin the difficulty curve.
 *
 * Randomness comes from the caller (a crypto seed per round, client-side
 * only), so the layout is reproducible from the seed and never touches the
 * server.
 */

/** Small, fast seeded PRNG (mulberry32) — plenty for scattering clovers. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MAX_ROUND = 8;

/** Rounds past the last one stay at the last one's difficulty. */
const clampRound = (round: number) => Math.min(Math.max(1, Math.floor(round)), MAX_ROUND);

// ─── Meadow ────────────────────────────────────────────────────────────────

export interface MeadowCell {
  rotate: number;
  /** 0..2 — which green; later rounds use fewer of them. */
  shade: number;
  /** A three-leaf with a starting fourth leaf (decoy). */
  bud: boolean;
  /** Offset from the cell centre, in % of the cell — later rounds wander. */
  dx: number;
  dy: number;
  /** Size relative to the cell; above 1 the clover spills into its
   *  neighbours, so leaves overlap and a fourth leaf may be someone else's. */
  scale: number;
  /** Stacking order among overlapping neighbours. */
  z: number;
}

export interface MeadowRound {
  columns: number;
  rows: number;
  lucky: number;
  cells: MeadowCell[];
}

/**
 * Round 1: 8×6, three greens, no decoys, every clover centred. Each round
 * adds a column and a row (up to 12×10) and narrows the greens (round 3+:
 * one). From round 2 the clovers wander off their cell centres; from round 3
 * they grow past the cell so neighbours OVERLAP, and decoys appear —
 * three-leafs with a bud — more of all of it every round. The click target
 * stays the cell, so the game is fair: the four-leaf is in its cell, however
 * tangled it looks.
 */
export function meadowRound(round: number, seed: number): MeadowRound {
  const r = clampRound(round);
  const rnd = prng(seed);
  const columns = Math.min(8 + (r - 1), 12);
  const rows = Math.min(6 + (r - 1), 10);
  const count = columns * rows;
  const lucky = Math.floor(rnd() * count);
  const shades = r >= 3 ? 1 : r === 2 ? 2 : 3;
  const budShare = r >= 3 ? Math.min(0.08 + 0.05 * (r - 3), 0.3) : 0;
  const wander = r >= 2 ? Math.min(12 * (r - 1), 35) : 0; // % of the cell
  const grow = r >= 3 ? Math.min(0.15 * (r - 2), 0.6) : 0; // extra size, up to +60 %
  const cells = Array.from({ length: count }, (_, i) => ({
    rotate: Math.round(rnd() * (r >= 2 ? 180 : 70)) - (r >= 2 ? 90 : 35),
    shade: shades === 1 ? 1 : Math.floor(rnd() * shades),
    bud: i !== lucky && rnd() < budShare,
    dx: Math.round((rnd() * 2 - 1) * wander),
    dy: Math.round((rnd() * 2 - 1) * wander),
    scale: 1 + rnd() * grow,
    z: Math.floor(rnd() * 3),
  }));
  return { columns, rows, lucky, cells };
}

// ─── Lens ──────────────────────────────────────────────────────────────────

export interface LensClover {
  /** Position in % of the field. */
  x: number;
  y: number;
  rotate: number;
  size: number;
  shade: number;
  bud: boolean;
}

export interface LensRound {
  clovers: LensClover[];
  lucky: LensClover;
  lensRadius: number;
  blur: number;
}

/**
 * Round 1: 60 clovers, lens radius 64 px, 5 px blur. Each round adds 20
 * clovers (up to 200), shrinks the lens by 4 px (down to 40) and blurs 1 px
 * more (up to 10); decoys with a bud from round 3. Positions are scattered
 * uniformly — the four-leaf keeps clear of the edges so the lens can reach
 * it whole.
 */
export function lensRound(round: number, seed: number): LensRound {
  const r = clampRound(round);
  const rnd = prng(seed);
  const total = Math.min(60 + 20 * (r - 1), 200);
  const budShare = r >= 3 ? Math.min(0.08 + 0.05 * (r - 3), 0.3) : 0;
  const make = (bud: boolean, margin: number): LensClover => ({
    x: margin + rnd() * (100 - 2 * margin),
    y: margin + rnd() * (100 - 2 * margin),
    rotate: Math.round(rnd() * 180) - 90,
    size: 24 + Math.floor(rnd() * 4) * 3,
    shade: r >= 3 ? 1 : Math.floor(rnd() * 3),
    bud,
  });
  const clovers = Array.from({ length: total }, () => make(rnd() < budShare, 3));
  const lucky = { ...make(false, 8), bud: false };
  return {
    clovers,
    lucky,
    lensRadius: Math.max(64 - 4 * (r - 1), 40),
    blur: Math.min(5 + (r - 1), 10),
  };
}

/** The greens, lightest to darkest — indexes of `shade`. */
export const SHADES = ["text-brand-500", "text-brand-600", "text-brand-700"] as const;

/** A fresh 32-bit seed from the browser's CSPRNG. */
export function newSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]!;
}

// ─── Clock ─────────────────────────────────────────────────────────────────

/** Round times so far → the numbers the footer shows. */
export function summarizeTimes(times: readonly number[]): {
  last: number | null;
  best: number | null;
  average: number | null;
  /** The last round beat every earlier one (needs at least two rounds). */
  newRecord: boolean;
} {
  if (times.length === 0) return { last: null, best: null, average: null, newRecord: false };
  const last = times[times.length - 1]!;
  const best = Math.min(...times);
  const earlier = times.slice(0, -1);
  return {
    last,
    best,
    average: times.reduce((a, b) => a + b, 0) / times.length,
    newRecord: earlier.length > 0 && last < Math.min(...earlier),
  };
}

/** Milliseconds as „12,3 s“ / „1:05,0“ (cs) or "12.3 s" / "1:05.0" (en). */
export function formatDuration(ms: number, locale: string): string {
  const tenths = Math.max(0, Math.round(ms / 100));
  const minutes = Math.floor(tenths / 600);
  const seconds = (tenths % 600) / 10;
  const sep = locale === "cs" ? "," : ".";
  const s = seconds.toFixed(1).replace(".", sep);
  return minutes > 0 ? `${minutes}:${s.padStart(4, "0")}` : `${s} s`;
}
