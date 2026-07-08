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
  /** Width for the surrounding LAYOUT — the prev/next nav bar, the
   *  location map + facts. Same as `widthCss` for normal photos, but
   *  floored at `minWidthPx` (when given) so a low-quality, unusually
   *  NARROW photo doesn't drag the whole detail page — and its nav +
   *  location section — down to a cramped column. The photo itself keeps
   *  `widthCss` (its native size, centred), the chrome around it doesn't. */
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
    /** Floor (in px) for `layoutWidthCss` only — the nav/map/facts chrome
     *  never gets narrower than this even when the photo does, so a narrow
     *  low-res photo can't cramp the whole detail page. The photo (`widthCss`)
     *  is untouched. Omit to keep the layout exactly matched to the photo. */
    minWidthPx?: number;
  },
): PhotoDisplay | null {
  if (!width || !height) return null;
  const landscape = rotate && width > height;
  const displayWidth = landscape ? height : width;
  const displayHeight = landscape ? width : height;
  // The photo's natural displayed width — native px, optionally clamped so
  // its height stays within `maxVh` of the viewport (maxVh === null drops
  // the clamp). `widthCss` then caps this at the container (100%).
  const naturalWidth =
    maxVh == null
      ? `${displayWidth}px`
      : `min(${displayWidth}px, calc(${maxVh}vh * ${displayWidth} / ${displayHeight}))`;
  const widthCss = fill ? "100%" : `min(100%, ${naturalWidth})`;
  return {
    rotated: landscape,
    displayWidth,
    displayHeight,
    aspectRatio: `${displayWidth} / ${displayHeight}`,
    widthCss,
    // Layout floored at `minWidthPx`: wide photo → matches the photo
    // (max resolves to the photo width); narrow photo → the floor, still
    // capped at the viewport. No floor (or fill) → identical to widthCss.
    layoutWidthCss:
      fill || minWidthPx == null
        ? widthCss
        : `min(100%, max(${minWidthPx}px, ${naturalWidth}))`,
  };
}
