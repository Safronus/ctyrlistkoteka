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
   *  0.20 → watermark spans 20% of the image's bottom edge. */
  widthRatio: number;
  /** Multiplier applied to the luminance-derived alpha. 0.0 = invisible,
   *  1.0 = full luminance contrast (very dark). 0.4 was the picked
   *  default during user review on find #1. */
  opacity: number;
  /** Padding from the image's right + bottom edges, as a fraction of
   *  image width. */
  marginRatio: number;
}

export const DEFAULT_WATERMARK_OPTIONS: WatermarkOptions = {
  widthRatio: 0.2,
  opacity: 0.4,
  marginRatio: 0.02,
};

/** Cached pre-processed watermark (luminance-masked + opacity-baked).
 *  Keyed by source path + options so repeated calls in a sweep don't
 *  re-decode the PNG. The cached buffer still needs per-image resizing,
 *  done at composite time. */
const watermarkCache = new Map<string, Buffer>();

function cacheKey(path: string, opts: WatermarkOptions): string {
  return `${path}|${opts.opacity}`;
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
  opacity: number,
): Promise<Buffer> {
  const sharp = require("sharp") as typeof import("sharp");
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
  const buf = await loadAndMaskWatermark(path, opts.opacity);
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
  const sharp = require("sharp") as typeof import("sharp");
  const targetW = Math.max(1, Math.round(width * opts.widthRatio));
  const margin = Math.max(0, Math.round(width * opts.marginRatio));

  const resized = await sharp(watermarkSourceBuffer)
    .resize({ width: targetW, withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });

  const left = Math.max(0, width - resized.info.width - margin);
  const top = Math.max(0, height - resized.info.height - margin);

  return pipeline.composite([
    { input: resized.data, left, top, blend: "over" },
  ]);
}
