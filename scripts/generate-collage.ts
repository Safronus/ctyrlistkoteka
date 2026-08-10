/**
 * Builds the four collage backgrounds for the `/d/<token>` landing pages.
 *
 *   pnpm collage                 # all four
 *   pnpm collage --only=SCATTER  # one
 *   pnpm collage --max-id=30000  # crops up to this find (default 30000)
 *
 * Runs where the crops live (the VPS), reads `find_images` for the CROP
 * thumbnails and writes `${GENERATED_DIR}/collage/<variant>.webp`.
 *
 * Why raw-buffer blitting rather than one big `sharp.composite()`: the
 * grid variants place tens of thousands of tiles, and handing sharp 30 000
 * composite inputs asks it to hold 30 000 decoded images at once. Resizing
 * each crop to a few pixels and copying those bytes into one canvas keeps
 * memory flat and finishes in minutes instead of not at all. The scatter
 * variant places a few hundred tiles with rotation and per-tile
 * transparency, which raw blitting can't do — that one uses composite,
 * where a few hundred inputs is fine.
 */

// FIRST, before anything reads process.env: a standalone tsx script gets
// no .env loading from Next, so DATABASE_URL and GENERATED_DIR would both
// be undefined — Prisma reports that as "client password must be a
// string", which says nothing about the actual cause. Same first line as
// scripts/sync.ts, for the same reason.
import "dotenv/config";

import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import { createPrismaClient } from "@/lib/prismaClient";
import {
  COLLAGE_IMAGE_MASKS,
  COLLAGE_VARIANTS,
  cloverMaskSvg,
  fitGridToMask,
  gridFor,
  makeRng,
  numberMaskSvg,
  scatterPlan,
  type CollageVariant,
} from "../src/lib/collage";

/** Long edge of the finished background. Big enough to fill a desktop
 *  header, small enough that the WebP stays a background and not a
 *  download — this page is read outdoors on mobile data. */
const OUT_WIDTH = 2400;
const OUT_ASPECT = 4 / 3;
const OUT_HEIGHT = Math.round(OUT_WIDTH / OUT_ASPECT);
/** Grid variants render larger and downscale, so the tiny tiles get
 *  antialiased down rather than aliasing at final size. */
const SUPERSAMPLE = 1.4;
/** Byte ceiling for a finished background. This page is opened outdoors,
 *  on mobile data, by someone standing over a laminated card — the first
 *  real run produced a 1.67 MB mosaic, which is several seconds of
 *  staring at nothing. Dense variants get re-encoded down to fit. */
const MAX_BYTES = 700 * 1024;
/**
 * Tried in order until one fits the ceiling.
 *
 * Width comes down before quality goes低 — a carpet of 30 000 crops has
 * 12-pixel tiles nobody can resolve anyway, so fewer pixels costs less
 * than mushier ones. The shaped variants sit on a plain backdrop, compress
 * easily and never leave the first step.
 */
const ENCODE_STEPS: Array<{ width: number; quality: number }> = [
  { width: 2400, quality: 72 },
  { width: 2400, quality: 60 },
  { width: 1920, quality: 65 },
  { width: 1920, quality: 55 },
  { width: 1600, quality: 60 },
  { width: 1600, quality: 45 },
];
/** Tiles on the scatter layer. Sparse on purpose — it is the variant
 *  meant to sit behind text. */
const SCATTER_TILES = 700;
const SCATTER_SEED = 30000;
/** Behind the tiles, so gaps and the shaped variants' background read as
 *  paper rather than black. */
const BACKDROP = { r: 246, g: 248, b: 244 };

const GENERATED_DIR = process.env.GENERATED_DIR
  ? path.resolve(process.env.GENERATED_DIR)
  : path.resolve(process.cwd(), "public", "generated");

interface Opts {
  only: CollageVariant | null;
  maxId: number;
  /** Take the tiles from a directory instead of the DB. For trying the
   *  look on a sample (and for testing the compositing on a machine that
   *  has no collection). The real run uses the DB. */
  fromDir: string | null;
  /** Write somewhere other than GENERATED_DIR/collage — so a trial run
   *  can't overwrite what the site is serving. */
  outDir: string | null;
}

function parseArgs(argv: string[]): Opts {
  const opts: Opts = { only: null, maxId: 30000, fromDir: null, outDir: null };
  for (const a of argv) {
    if (a.startsWith("--from-dir=")) {
      opts.fromDir = path.resolve(a.slice(11));
    } else if (a.startsWith("--out-dir=")) {
      opts.outDir = path.resolve(a.slice(10));
    } else if (a.startsWith("--only=")) {
      const v = a.slice(7).toUpperCase() as CollageVariant;
      if (!COLLAGE_VARIANTS.includes(v)) {
        throw new Error(
          `--only musí být jedna z: ${COLLAGE_VARIANTS.join(", ")}`,
        );
      }
      opts.only = v;
    } else if (a.startsWith("--max-id=")) {
      const n = Number(a.slice(9));
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error("--max-id musí být kladné celé číslo");
      }
      opts.maxId = n;
    } else if (a !== "") {
      throw new Error(`Neznámý argument: ${a}`);
    }
  }
  return opts;
}

/** Absolute paths of the crop thumbnails, oldest find first.
 *
 *  Anonymized finds are included deliberately (owner's call, 2026-08-10):
 *  a crop is the leaf alone — no GPS, no note, no location — and /sbirka
 *  already shows those crops. */
async function cropFiles(maxId: number): Promise<string[]> {
  const prisma = createPrismaClient();
  try {
    const rows = await prisma.$queryRaw<Array<{ thumb_path: string }>>`
      SELECT fi.thumb_path
      FROM find_images fi
      WHERE fi.image_type = 'CROP'
        AND fi.find_id BETWEEN 1 AND ${maxId}
      ORDER BY fi.find_id, fi.sort_order
    `;
    return rows
      .map((r) => r.thumb_path)
      .filter((p) => p.startsWith("/generated/"))
      .map((p) => path.join(GENERATED_DIR, p.slice("/generated/".length)));
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Mask sampled from a drawing in `public/` rather than from SVG.
 *
 * Two kinds of source turn up and they need opposite readings: a cut-out
 * with a transparent background (the site's clover) carries the shape in
 * its ALPHA, while a scan of a pen drawing carries it in its DARKNESS.
 * Guessing wrong gives a perfect negative, so decide from the file: if a
 * good share of pixels are fully transparent, it's a cut-out.
 */
async function sampleImageMask(
  file: string,
  cols: number,
  rows: number,
): Promise<Buffer> {
  const img = sharp(file).resize(cols, rows, {
    fit: "contain",
    background: { r: 255, g: 255, b: 255, alpha: 0 },
  });
  const { data, info } = await img
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const n = cols * rows;
  const ch = info.channels;
  let transparent = 0;
  for (let i = 0; i < n; i++) if (data[i * ch + 3]! < 32) transparent++;
  const isCutout = transparent > n * 0.15;

  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const a = data[i * ch + 3]!;
    if (isCutout) {
      out[i] = a > 127 ? 255 : 0;
    } else {
      // Luminance, inverted: ink is the shape, paper is not.
      const lum =
        0.299 * data[i * ch]! + 0.587 * data[i * ch + 1]! + 0.114 * data[i * ch + 2]!;
      out[i] = a > 127 && lum < 140 ? 255 : 0;
    }
  }
  return out;
}

/** Mask as one byte per grid cell (255 = draw a tile here). */
async function sampleMask(
  svg: (w: number, h: number) => string,
  cols: number,
  rows: number,
): Promise<Buffer> {
  return await sharp(Buffer.from(svg(cols * 8, rows * 8)))
    .resize(cols, rows, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
}

/**
 * Encodes to WebP, stepping quality down until it fits the byte ceiling.
 *
 * Only the busiest variants ever need the lower steps: a shape on a plain
 * backdrop compresses far better than a full-bleed carpet of photos. The
 * step that was used gets logged, so a background that had to be squeezed
 * says so instead of quietly looking worse.
 */
async function encodeWithin(
  pipeline: (width: number, height: number) => Sharp,
  label: string,
): Promise<Buffer> {
  // Seeded with the first step's result inside the loop; ENCODE_STEPS is
  // never empty, so by the warn below this always holds a buffer.
  let last = Buffer.alloc(0);
  for (const [i, step] of ENCODE_STEPS.entries()) {
    const height = Math.round(step.width / OUT_ASPECT);
    last = await pipeline(step.width, height)
      .webp({ quality: step.quality })
      .toBuffer();
    if (last.length <= MAX_BYTES) {
      if (i > 0) {
        console.log(
          `  ${label}: ${step.width} px / kvalita ${step.quality} (aby se vešlo pod ${Math.round(MAX_BYTES / 1024)} kB)`,
        );
      }
      return last;
    }
  }
  const worst = ENCODE_STEPS[ENCODE_STEPS.length - 1]!;
  console.warn(
    `  ${label}: ani ${worst.width} px / kvalita ${worst.quality} se nevešlo pod ${Math.round(MAX_BYTES / 1024)} kB (${Math.round(last.length / 1024)} kB) — nechávám tak.`,
  );
  return last;
}

/** Cells the mask lights up, in reading order. */
function onCells(mask: Buffer, cols: number, rows: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < cols * rows; i++) if (mask[i]! > 127) out.push(i);
  return out;
}

/**
 * Grid variants: resize each crop to one cell and copy its bytes into a
 * single RGB canvas.
 *
 * `cells` is where the tiles go — every cell for MOSAIC, only the lit
 * ones for the shaped variants.
 */
async function renderGrid(
  files: string[],
  cols: number,
  rows: number,
  cells: number[],
  label: string,
): Promise<Buffer> {
  const tile = Math.max(4, Math.floor((OUT_WIDTH * SUPERSAMPLE) / cols));
  const W = tile * cols;
  const H = tile * rows;
  const canvas = Buffer.alloc(W * H * 3);
  for (let i = 0; i < canvas.length; i += 3) {
    canvas[i] = BACKDROP.r;
    canvas[i + 1] = BACKDROP.g;
    canvas[i + 2] = BACKDROP.b;
  }

  // Every lit cell gets a tile. When there are more cells than crops the
  // list cycles rather than leaving holes — a gap in the middle of the
  // clover reads as a bug, and a crop appearing twice does not.
  const count = cells.length;
  let done = 0;
  const CONCURRENCY = 8;
  let next = 0;

  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= count) return;
      const cell = cells[i]!;
      const cx = (cell % cols) * tile;
      const cy = Math.floor(cell / cols) * tile;
      let px: Buffer;
      try {
        px = await sharp(files[i % files.length]!)
          .resize(tile, tile, { fit: "cover", position: "centre" })
          .removeAlpha()
          .raw()
          .toBuffer();
      } catch {
        continue; // a missing or unreadable crop leaves the backdrop
      }
      for (let y = 0; y < tile; y++) {
        px.copy(
          canvas,
          ((cy + y) * W + cx) * 3,
          y * tile * 3,
          (y + 1) * tile * 3,
        );
      }
      done++;
      if (done % 2000 === 0) {
        console.log(`  ${label}: ${done}/${count} ořezů`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(
    `  ${label}: ${done} dlaždic z ${files.length} ořezů` +
      (count > files.length ? ` (${count - files.length}× se ořez zopakoval)` : "") +
      ` — mřížka ${cols}×${rows}, dlaždice ${tile} px`,
  );

  return await encodeWithin(
    (w, h) =>
      sharp(canvas, { raw: { width: W, height: H, channels: 3 } }).resize(w, h, {
        fit: "cover",
      }),
    label,
  );
}

/** Scatter: a few hundred crops, rotated, part-transparent, overlapping. */
async function renderScatter(files: string[]): Promise<Buffer> {
  const plan = scatterPlan(
    SCATTER_TILES,
    OUT_WIDTH,
    OUT_HEIGHT,
    makeRng(SCATTER_SEED),
  );
  // Spread the picks across the whole collection rather than taking the
  // first 700 — otherwise the layer is a snapshot of 2016 and nothing else.
  const step = Math.max(1, Math.floor(files.length / plan.length));

  const layers = [];
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i]!;
    const file = files[(i * step) % files.length];
    if (!file) continue;
    try {
      const input = await sharp(file)
        .resize(p.size, p.size, { fit: "cover", position: "centre" })
        .ensureAlpha(p.opacity)
        .rotate(p.rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      layers.push({ input, left: p.x, top: p.y });
    } catch {
      continue;
    }
  }
  console.log(`  SCATTER: ${layers.length}/${plan.length} dlaždic`);

  // The scatter layer is planned at OUT_WIDTH, so it composites there and
  // is only resized afterwards — re-planning per step would move every
  // tile and break the seed's reproducibility.
  const full = sharp({
    create: {
      width: OUT_WIDTH,
      height: OUT_HEIGHT,
      channels: 3,
      background: BACKDROP,
    },
  })
    .composite(layers)
    .png();
  const flat = await full.toBuffer();
  return await encodeWithin(
    (w, h) => sharp(flat).resize(w, h, { fit: "cover" }),
    "SCATTER",
  );
}

async function buildVariant(
  variant: CollageVariant,
  files: string[],
  maskFile: string | undefined,
): Promise<Buffer> {
  if (variant === "SCATTER") return await renderScatter(files);
  if (variant === "MOSAIC") {
    const { cols, rows } = gridFor(files.length, OUT_ASPECT);
    const cells = Array.from({ length: cols * rows }, (_, i) => i);
    return await renderGrid(files, cols, rows, cells, "MOSAIC");
  }

  // Shaped: find the grid at which the shape has room for every crop, so
  // the crops really do form the clover rather than a sampled sketch of it.
  const svg = variant === "CLOVER" ? cloverMaskSvg : numberMaskSvg;
  const cache = new Map<string, Buffer>();
  const maskFor = async (cols: number, rows: number) => {
    const key = `${cols}x${rows}`;
    let m = cache.get(key);
    if (!m) {
      m = maskFile
        ? await sampleImageMask(path.resolve(maskFile), cols, rows)
        : await sampleMask(svg, cols, rows);
      cache.set(key, m);
    }
    return m;
  };

  // Probe the mask at exactly the resolution being asked about. The
  // binary search visits ~11 of them and each is one small resize, so
  // sampling for real costs a second and buys a correct answer — the
  // earlier "nearest sampled resolution" shortcut overstated the room and
  // left 6 000 crops out of the clover.
  const MAX_COLS = 1200;
  const counted = new Map<number, number>();
  const countOn = async (cols: number, rows: number) => {
    const hit = counted.get(cols);
    if (hit !== undefined) return hit;
    const n = onCells(await maskFor(cols, rows), cols, rows).length;
    counted.set(cols, n);
    return n;
  };

  const fitted = await fitGridToMask(
    files.length,
    OUT_ASPECT,
    countOn,
    MAX_COLS,
  );
  const { cols, rows } = fitted ?? {
    cols: MAX_COLS,
    rows: Math.round(MAX_COLS / OUT_ASPECT),
  };
  if (!fitted) {
    console.warn(
      `  ${variant}: tvar nepobere všech ${files.length} ořezů ani při ${MAX_COLS} sloupcích — vejde se jich míň, zbytek se nekreslí.`,
    );
  }
  const cells = onCells(await maskFor(cols, rows), cols, rows);
  return await renderGrid(files, cols, rows, cells, variant);
}

/** First path that exists, or undefined. */
async function firstExisting(paths: string[]): Promise<string | undefined> {
  for (const p of paths) {
    try {
      await access(path.resolve(p));
      return p;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

/** Tiles from a plain directory — the `--from-dir` path. */
async function dirFiles(dir: string): Promise<string[]> {
  const names = await readdir(dir);
  return names
    .filter((n) => /\.(webp|jpe?g|png)$/i.test(n))
    .sort()
    .map((n) => path.join(dir, n));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const files = opts.fromDir
    ? await dirFiles(opts.fromDir)
    : await cropFiles(opts.maxId);
  if (files.length === 0) {
    throw new Error(
      opts.fromDir
        ? `V ${opts.fromDir} nejsou žádné obrázky.`
        : `Žádné ořezy pro nálezy 1–${opts.maxId}. Zkontroluj GENERATED_DIR (${GENERATED_DIR}) a DB.`,
    );
  }
  console.log(
    `Ořezů k dispozici: ${files.length}` +
      (opts.fromDir ? ` (z ${opts.fromDir})` : ` (nálezy 1–${opts.maxId})`),
  );

  const outDir = opts.outDir ?? path.join(GENERATED_DIR, "collage");
  await mkdir(outDir, { recursive: true });

  const wanted = opts.only ? [opts.only] : [...COLLAGE_VARIANTS];
  for (const v of wanted) {
    // A variant whose outline lives in a file can't be drawn without it.
    // Skip it and name the files it looked for — silently emitting a blank
    // background would look like the generator worked.
    const candidates = COLLAGE_IMAGE_MASKS[v];
    let maskFile: string | undefined;
    if (candidates) {
      maskFile = await firstExisting(candidates);
      if (!maskFile) {
        console.warn(
          `⚠ ${v}: nenašel jsem předlohu (${candidates.join(" ani ")}) — přeskakuji.`,
        );
        continue;
      }
      console.log(`  ${v}: předloha ${maskFile}`);
    }
    const started = Date.now();
    const buf = await buildVariant(v, files, maskFile);
    const out = path.join(outDir, `${v.toLowerCase()}.webp`);
    await writeFile(out, buf);
    console.log(
      `✓ ${v} → ${out} (${(buf.length / 1024).toFixed(0)} kB, ${(
        (Date.now() - started) / 1000
      ).toFixed(1)} s)`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
