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
  /** Shared `width` for the photo box, the prev/next nav bar AND the
   *  location-map figure — they all track it so the detail column reads as
   *  one aligned unit. With `minWidthPx` set, an unusually tall/narrow photo
   *  gets a floored width here (see the option) so the whole column stays
   *  usable instead of collapsing to a cramped strip. */
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
    /** Minimum displayed width (px) for the photo, which RELAXES the `maxVh`
     *  height cap up to this floor — but never past the native pixel width
     *  (so a low-res photo is never upscaled) or the container (100%). Lets
     *  an unusually tall/narrow photo (e.g. a 739×1600 portrait squeezed to
     *  ~290 px by the 70vh cap) display comfortably wide instead of dragging
     *  the whole aligned detail column — photo, nav bar and location map —
     *  into a cramped strip. Omit to keep the plain height-capped width. */
    minWidthPx?: number;
  },
): PhotoDisplay | null {
  if (!width || !height) return null;
  const landscape = rotate && width > height;
  const displayWidth = landscape ? height : width;
  const displayHeight = landscape ? width : height;
  // Displayed width: native px, height-capped to `maxVh` of the viewport.
  // `minWidthPx` lifts the height cap up to a floor (bounded by native px so
  // it never upscales), so tall/narrow photos aren't squeezed to a strip.
  let widthCss: string;
  if (fill) {
    widthCss = "100%";
  } else if (maxVh == null) {
    widthCss = `min(100%, ${displayWidth}px)`;
  } else {
    const cap = `calc(${maxVh}vh * ${displayWidth} / ${displayHeight})`;
    const heightBound =
      minWidthPx == null
        ? cap
        : `max(${cap}, min(${minWidthPx}px, ${displayWidth}px))`;
    widthCss = `min(100%, ${displayWidth}px, ${heightBound})`;
  }
  return {
    rotated: landscape,
    displayWidth,
    displayHeight,
    aspectRatio: `${displayWidth} / ${displayHeight}`,
    widthCss,
  };
}
