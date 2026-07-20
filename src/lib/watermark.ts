/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Watermark compositing — bakes the brand watermark into the bottom-right
 * corner of a generated WebP. Used both by the one-shot
 * `scripts/apply-watermark.ts` sweep and (Phase 2) by sync's per-image
 * generation pipeline.
 *
 * The supplied PNG is treated as a black-on-white doodle: each pixel's
 * darkness becomes the watermark's opacity (so any pure-white background
 * silently becomes fully transparent and the user doesn't have to
 * pre-mask the file). Final alpha is multiplied by `opacity` for the
 * subtle "visible but not loud" look the user asked for.
 */

import { readFile } from "node:fs/promises";

export interface WatermarkOptions {
  /** Width of the rendered watermark as a fraction of image width.
   *  0.10 → watermark spans 10% of the image's bottom edge. Note: this
   *  is the *pre-rotation* width; rotating expands the bounding box, so
   *  the on-screen footprint along the bottom edge ends up roughly
   *  widthRatio · |cos(rotation)| + heightOfDoodle · |sin(rotation)|. */
  widthRatio: number;
  /** Multiplier applied to the luminance-derived alpha. 0.0 = invisible,
   *  1.0 = full luminance contrast (very dark). 0.4 was the picked
   *  default during user review on find #1. */
  opacity: number;
  /** Padding from the image's right + bottom edges, as a fraction of
   *  image width. */
  marginRatio: number;
  /** Rotation in degrees, **counter-clockwise positive** to match the
   *  Czech UX wording ("doleva" = left). 0 = no rotation. The rotated
   *  bounding box still anchors to the bottom-right corner with the
   *  configured margin. */
  rotation: number;
  /** Ink colour the doodle is recoloured to (sRGB 0–255). The source
   *  PNG's darkness still drives the alpha *shape*; only the RGB is
   *  replaced. Omit to keep the doodle's own colour (black). The site
   *  bakes the mark in its pale clover-green so it reads as part of the
   *  green theme rather than a hard black stamp. */
  color?: { r: number; g: number; b: number };
  /** Adaptive contrast fallback. When set, the composite samples the corner
   *  the mark lands on and picks whichever of `color` / `colorAlt` sits
   *  *further* from that corner's mean luminance — i.e. whichever reads with
   *  more contrast. Omit to always use `color`.
   *
   *  The collection is green foliage, so `color` is the pale page-green
   *  (reads on the medium-green corners that dominate) and `colorAlt` is the
   *  dark brand-green, auto-chosen only where the corner is bright enough
   *  (highlights) that the pale mark would wash out. */
  colorAlt?: { r: number; g: number; b: number };
}

export const DEFAULT_WATERMARK_OPTIONS: WatermarkOptions = {
  widthRatio: 0.1,
  // Full opacity: a pale mark reads by *lightening* the corner, and at less
  // than full strength it washed into the busy green foliage. Solid is the
  // look the owner picked on real photos.
  opacity: 1,
  // 0.5% of width — tight to the corner. The post-rotation .trim() pass
  // (see compositeWatermarkOnto) removes the transparent padding the
  // rotation adds, so this margin applies to the doodle's actual visible
  // bounding box rather than to a much larger transparent rectangle.
  marginRatio: 0.005,
  rotation: 45,
  // Pale page-background green (oklch 0.965 0.038 145 → sRGB) as the PRIMARY
  // ink. The collection is green foliage whose corners are mostly
  // medium-bright green; a solid pale mark reads there, while a dark green
  // mark shares the hue and disappears. See the contrast study 2026-07-15.
  color: { r: 228, g: 251, b: 228 },
  // Dark clover-green (brand-800) as the contrast fallback, auto-chosen by
  // compositeWatermarkOnto only where the corner is bright enough (a sunlit
  // highlight) that the pale mark would wash out.
  colorAlt: { r: 0, g: 73, b: 6 },
};

/** Cached pre-processed watermark (luminance-masked + opacity-baked).
 *  Keyed by source path + options so repeated calls in a sweep don't
 *  re-decode the PNG. The cached buffer still needs per-image resizing,
 *  done at composite time. */
const watermarkCache = new Map<string, Buffer>();

function cacheKey(path: string, opts: WatermarkOptions): string {
  const c = opts.color ? `${opts.color.r},${opts.color.g},${opts.color.b}` : "ink";
  return `${path}|${opts.opacity}|${c}`;
}

/**
 * Reads a black-on-white PNG and returns a buffer where:
 *   - every pixel's alpha = (255 - max(R,G,B)) * opacity
 *   - colors are kept as-is so the doodle composites in its original
 *     ink colour (black) over the photo
 *
 * The result is a PNG buffer (lossless) sized at the watermark's
 * native resolution — callers resize per-target.
 */
async function loadAndMaskWatermark(
  path: string,
  opts: WatermarkOptions,
): Promise<Buffer> {
  const { opacity, color } = opts;
  const sharp = require("sharp") as typeof import("sharp").default;
  const wm = sharp(path).ensureAlpha();
  const { data, info } = await wm
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Combined alpha = original_alpha · ink_density · opacity.
  //   - For a transparent-bg PNG (alpha = 0 outside the ink): the
  //     bounding-box stays invisible because the original_alpha factor
  //     zeroes it out. Without this, RGB = (0,0,0) on transparent
  //     pixels would be misread as fully-black ink.
  //   - For a flat white-bg PNG (alpha = 255 everywhere): the
  //     ink-density factor (1 − max(R,G,B)/255) collapses white to
  //     transparent, keeping ink opaque.
  //
  // `?? 0` satisfies `noUncheckedIndexedAccess`; the buffer is
  // contiguous so values can't actually be undefined at runtime.
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const a = data[i + 3] ?? 0;
    // max(R,G,B) — peak channel — best preserves the doodle's
    // anti-aliased stroke edges without graying them.
    const lum = r > g ? (r > b ? r : b) : g > b ? g : b;
    const inkDensity = 255 - lum;
    // Multiply original alpha (0..255) by ink density (0..255) by
    // opacity (0..1), divide by 255 once to keep the result in 0..255.
    data[i + 3] = Math.round((a * inkDensity * opacity) / 255);
    // Recolour the ink: the darkness above already became the alpha
    // shape, so overwrite RGB with the target colour. Pixels that ended
    // up fully transparent keep whatever RGB — it's never composited.
    if (color) {
      data[i] = color.r;
      data[i + 1] = color.g;
      data[i + 2] = color.b;
    }
  }

  return await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

export async function getWatermarkBuffer(
  path: string,
  opts: WatermarkOptions = DEFAULT_WATERMARK_OPTIONS,
): Promise<Buffer> {
  const key = cacheKey(path, opts);
  const cached = watermarkCache.get(key);
  if (cached) return cached;
  // Validate the file exists upfront so the error message points to the
  // configured path rather than failing inside sharp's decoder.
  await readFile(path); // throws ENOENT with full path
  const buf = await loadAndMaskWatermark(path, opts);
  watermarkCache.set(key, buf);
  return buf;
}

/**
 * Applies the cached watermark to a sharp pipeline. Caller is responsible
 * for the final encoding (.webp({...}).toBuffer() / .toFile()) so this
 * helper composes cleanly into the existing image-generation pipeline.
 */
export async function compositeWatermarkOnto(
  pipeline: import("sharp").Sharp,
  width: number,
  height: number,
  watermarkSourceBuffer: Buffer,
  opts: WatermarkOptions = DEFAULT_WATERMARK_OPTIONS,
): Promise<import("sharp").Sharp> {
  const sharp = require("sharp") as typeof import("sharp").default;
  const targetW = Math.max(1, Math.round(width * opts.widthRatio));
  const margin = Math.max(0, Math.round(width * opts.marginRatio));

  // Resize first, then rotate, then trim the transparent padding the
  // rotation introduces so the visible doodle hugs whatever corner we
  // drop it into. Without the trim the post-rotation buffer is the
  // diagonal bounding box (≈ √2 × the doodle), which made the watermark
  // sit far from the edge even at margin 0.
  //
  // Sharp rotates clockwise for positive angles, so we negate
  // `rotation` (which is CCW-positive in our public API).
  let wmPipeline = sharp(watermarkSourceBuffer).resize({
    width: targetW,
    withoutEnlargement: false,
  });
  if (opts.rotation !== 0) {
    wmPipeline = wmPipeline.rotate(-opts.rotation, {
      // Transparent fill for the corners introduced by rotation —
      // anything else would draw a coloured triangle around the doodle.
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }
  // Trim the all-transparent border (threshold = 1 keeps any pixel with
  // alpha > 1, i.e. only true transparent rows/cols are removed). Wrap
  // in a try/catch because sharp.trim() throws if there's nothing to
  // trim — that shouldn't happen for our masked PNG, but a safety net is
  // cheap.
  try {
    wmPipeline = wmPipeline.trim({ threshold: 1 });
  } catch {
    // ignore — original buffer continues unchanged
  }
  const resized = await wmPipeline
    .png()
    .toBuffer({ resolveWithObject: true });

  const left = Math.max(0, width - resized.info.width - margin);
  const top = Math.max(0, height - resized.info.height - margin);

  // Adaptive contrast: sample the mean luminance of the exact rectangle the
  // mark lands on and pick whichever ink — the primary `color` (already baked
  // into `resized.data`) or `colorAlt` — sits FURTHER from that luminance, so
  // the mark reads with the most contrast. The pale primary wins on the
  // medium-green corners that dominate the collection; the dark fallback wins
  // only on bright highlights where pale would wash out. The clone shares the
  // re-readable input, so the real composite below is unaffected; an
  // unreadable region keeps the primary ink.
  // Explicitly widened: sharp ≥0.35 types toBuffer() as Buffer<ArrayBuffer>,
  // but recolorShape() returns a plain Buffer<ArrayBufferLike>. composite()
  // takes the wide type, so widen here instead of narrowing recolorShape.
  let markData: Buffer = resized.data;
  if (opts.colorAlt) {
    const sw = Math.max(1, Math.min(resized.info.width, width - left));
    const sh = Math.max(1, Math.min(resized.info.height, height - top));
    const lum = (c: { r: number; g: number; b: number }): number =>
      0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    try {
      const stats = await pipeline
        .clone()
        .extract({ left, top, width: sw, height: sh })
        .stats();
      const [rc, gc, bc] = stats.channels;
      const mean =
        0.299 * (rc?.mean ?? 0) +
        0.587 * (gc?.mean ?? 0) +
        0.114 * (bc?.mean ?? 0);
      const primaryLum = opts.color ? lum(opts.color) : 0;
      if (Math.abs(mean - lum(opts.colorAlt)) > Math.abs(mean - primaryLum)) {
        markData = await recolorShape(resized.data, opts.colorAlt);
      }
    } catch {
      // Degenerate / unreadable region — keep the primary ink.
    }
  }

  return pipeline.composite([{ input: markData, left, top, blend: "over" }]);
}

/** Overwrites a masked watermark PNG's RGB with `color` while keeping its
 *  alpha *shape* — used to swap the pale mark for the dark one on a light
 *  corner. */
async function recolorShape(
  pngBuffer: Buffer,
  color: { r: number; g: number; b: number },
): Promise<Buffer> {
  const sharp = require("sharp") as typeof import("sharp").default;
  const { data, info } = await sharp(pngBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color.r;
    data[i + 1] = color.g;
    data[i + 2] = color.b;
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}
