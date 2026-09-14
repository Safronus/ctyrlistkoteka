import jsQR from "jsqr";
import sharp from "sharp";

/**
 * Asks a real decoder whether a styled code reads, instead of guessing
 * from contrast arithmetic.
 *
 * Contrast ratios predict badly here: a red pupil on the manual's light
 * blue is 2.5 : 1 by WCAG and sits almost exactly on a decoder's grey
 * threshold, so it reads on one render and not the next; a grey pupil at
 * 3.4 : 1 on white fails outright. What decides is where each colour
 * lands in the decoder's own greyscale relative to its neighbours, and
 * the only honest way to know is to run one. jsQR is a plain-JS decoder
 * with a fixed-block binariser — stricter than a phone in some ways
 * (it loses sparse dots on a LARGE render), similar in the ways that
 * matter for print. Four sizes, from crisp to three pixels per module.
 */

export interface CasqbDecodeResult {
  /** Render width in px and whether jsQR read the expected text. */
  sizes: Array<{ px: number; ok: boolean }>;
  /** ok = every size read; risky = some did; fail = none did. */
  verdict: "ok" | "risky" | "fail";
}

/** Widths tried, largest first; the last two scale with the matrix so a
 *  bigger code is not tested at fewer pixels per module. */
function widthsFor(modules: number): number[] {
  const side = modules + 8;
  return [400, 260, side * 4, side * 3];
}

async function decodeAt(svg: string, px: number, expected: string): Promise<boolean> {
  const { data, info } = await sharp(Buffer.from(svg))
    .resize(px, px)
    .flatten({ background: "#ffffff" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const r = jsQR(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    info.width,
    info.height,
  );
  return r?.data === expected;
}

export async function casqbDecodeCheck(
  svg: string,
  expected: string,
  modules: number,
): Promise<CasqbDecodeResult> {
  const sizes = await Promise.all(
    widthsFor(modules).map(async (px) => ({ px, ok: await decodeAt(svg, px, expected) })),
  );
  const okCount = sizes.filter((s) => s.ok).length;
  return {
    sizes,
    verdict: okCount === sizes.length ? "ok" : okCount === 0 ? "fail" : "risky",
  };
}
