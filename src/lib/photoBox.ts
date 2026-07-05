/**
 * Shared geometry for the find-detail photo box.
 *
 * The find photo is displayed at its natural size, height-capped at 70vh.
 * Landscape originals (width > height) are rotated 90° clockwise so they
 * read as portrait — otherwise the photo (and the location map pinned to
 * the SAME width below it) would be far too wide.
 *
 * `widthCss` is a pure CSS expression computed from the image's pixel
 * dimensions, so BOTH the photo box and the location-map figure can use
 * the exact same value and line up at every viewport size — no client
 * measurement, no layout jump. The location map is widened to the photo,
 * never the other way around.
 */
export interface PhotoDisplay {
  /** True when the original is landscape and gets rotated to portrait. */
  rotated: boolean;
  /** Displayed (post-rotation) width / height in source pixels. */
  displayWidth: number;
  displayHeight: number;
  /** `aspect-ratio` for the reserved image box (portrait after rotation). */
  aspectRatio: string;
  /** Shared `width` for the photo box AND the location-map figure. */
  widthCss: string;
}

/** Default fraction of the viewport height the photo may occupy. */
const MAX_VH = 70;

export function photoDisplay(
  width: number | null | undefined,
  height: number | null | undefined,
  {
    rotate,
    maxVh = MAX_VH,
  }: {
    rotate: boolean;
    /** Cap the photo's height at this % of the viewport, so a tall portrait
     *  still fits on screen. The find detail keeps the default. Pass `null`
     *  to drop the cap entirely — the home showcase + "První vs poslední"
     *  photos do this so a portrait fills the full column width (the user
     *  prefers the big full-width look even though a tall portrait then
     *  scrolls past the fold). */
    maxVh?: number | null;
  },
): PhotoDisplay | null {
  if (!width || !height) return null;
  const landscape = rotate && width > height;
  const displayWidth = landscape ? height : width;
  const displayHeight = landscape ? width : height;
  // No cap (maxVh === null) → width is just min(fits the column, native px).
  // With a cap, also clamp so the height stays within `maxVh` of the viewport.
  const heightCap =
    maxVh == null
      ? ""
      : `, calc(${maxVh}vh * ${displayWidth} / ${displayHeight})`;
  return {
    rotated: landscape,
    displayWidth,
    displayHeight,
    aspectRatio: `${displayWidth} / ${displayHeight}`,
    // min(fits the column, never upscale past native[, height-cap at maxVh])
    widthCss: `min(100%, ${displayWidth}px${heightCap})`,
  };
}
