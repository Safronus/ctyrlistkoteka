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
  /** Native (height-capped) displayed width for the PHOTO box + the location
   *  map + facts below it — they all track it so photo, map and facts line up
   *  as one column. Wide photos are untouched; a tall/narrow photo simply
   *  stays at its (possibly narrow) height-capped width. */
  widthCss: string;
  /** Width for the prev/next NAV bar's "Zpět na sbírku" column, floored at
   *  `minWidthPx`. The back link is pinned to the LEFT of this centered
   *  column; without a floor it collides with the centered prev/next links
   *  whenever the photo below is narrow. Same as `widthCss` once the photo is
   *  already wider than the floor (so wide photos keep the nav aligned to the
   *  image, as before). */
  layoutWidthCss: string;
}

/** Default fraction of the viewport height the photo may occupy. */
const MAX_VH = 70;

export function photoDisplay(
  width: number | null | undefined,
  height: number | null | undefined,
  {
    rotate,
    maxVh = MAX_VH,
    fill = false,
    minWidthPx,
  }: {
    rotate: boolean;
    /** Cap the photo's height at this % of the viewport, so a tall portrait
     *  still fits on screen. The find detail keeps the default. Pass `null`
     *  to drop the cap entirely — the home showcase + "První vs poslední"
     *  photos do this so a portrait fills the full column width (the user
     *  prefers the big full-width look even though a tall portrait then
     *  scrolls past the fold). */
    maxVh?: number | null;
    /** Fill exactly 100% of the container width, upscaling past native px if
     *  needed. The home showcase uses this so its left/right edges line up
     *  precisely with the container — i.e. with the left edge of the first
     *  find's photo and the right edge of the last find's photo, which span
     *  it. Overrides both the native-px cap and maxVh. */
    fill?: boolean;
    /** Minimum width (px) for the prev/next NAV bar column ONLY (see
     *  `layoutWidthCss`). It does NOT touch the photo or the map — those keep
     *  their native height-capped width. Flooring just the nav keeps the
     *  "Zpět na sbírku" back link (pinned to the column's left edge) clear of
     *  the centered prev/next links even when the photo below is narrow. The
     *  photo can then sit at whatever (smaller) width it is; the nav stays
     *  comfortably wide. Omit to keep the nav equal to the photo width. */
    minWidthPx?: number;
  },
): PhotoDisplay | null {
  if (!width || !height) return null;
  const landscape = rotate && width > height;
  const displayWidth = landscape ? height : width;
  const displayHeight = landscape ? width : height;
  // Native displayed width: native px, height-capped to `maxVh` of the
  // viewport. This drives the PHOTO + map + facts — wide photos unchanged,
  // narrow photos left as-is (never upscaled).
  const naturalWidth =
    maxVh == null
      ? `${displayWidth}px`
      : `min(${displayWidth}px, calc(${maxVh}vh * ${displayWidth} / ${displayHeight}))`;
  const widthCss = fill ? "100%" : `min(100%, ${naturalWidth})`;
  // Nav-bar width: floored at `minWidthPx` so the back link clears the prev/
  // next even when the photo is narrow. The nav has no image, so — unlike the
  // photo — it MAY exceed the native px width. Collapses to `widthCss` for
  // wide photos (already past the floor) and whenever no floor is given.
  const layoutWidthCss =
    fill || minWidthPx == null
      ? widthCss
      : `min(100%, max(${minWidthPx}px, ${naturalWidth}))`;
  return {
    rotated: landscape,
    displayWidth,
    displayHeight,
    aspectRatio: `${displayWidth} / ${displayHeight}`,
    widthCss,
    layoutWidthCss,
  };
}
