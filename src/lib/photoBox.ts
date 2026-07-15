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
  /** Present only for the home showcase (opt in via `landscapeOnTall`). See
   *  {@link TallRotate}. Everything else leaves it undefined and renders
   *  exactly as before. */
  tallRotate?: TallRotate;
}

/** Showcase-only viewport-conditional LANDSCAPE flip.
 *
 *  The random-find showcase spans the full page column so its left/right
 *  edges line up with the "První vs poslední" pair above it. But a full-width
 *  TALL portrait then overflows a short window (e.g. FullHD) — you only see
 *  the top half. On wide windows where the upright full-width portrait no
 *  longer fits the viewport height, we flip the DISPLAY to landscape: still
 *  full width (edges keep lining up), now short enough to fit. `ImageGallery`
 *  turns these numbers into a per-image `@media` rule (no JS, no flash). */
export interface TallRotate {
  /** `min-width` of the media query — at/above this the page column is at its
   *  capped width, so the portrait is at its tallest (below it the photo is
   *  narrower and more likely to fit upright, so we don't flip). */
  minWidthPx: number;
  /** `max-height` of the media query — below this the upright full-width
   *  portrait no longer fits, so flip to landscape. */
  maxHeightPx: number;
  /** Box `aspect-ratio` in the flipped (landscape) state (width / height). */
  altAspectRatio: string;
  /** Whether the IMG is 90°-rotated in the flipped state: true for a portrait
   *  original (must rotate to read landscape), false for a landscape original
   *  (the flip just drops the portrait rotation, showing it natural). */
  altRotated: boolean;
}

/** Default fraction of the viewport height the photo may occupy. */
const MAX_VH = 70;

/** Home page column width on wide viewports: max-w-7xl (1280) − lg px-8 (64).
 *  Used to size the landscape-flip media-query threshold. */
const SHOWCASE_MAX_WIDTH_PX = 1216;
/** Vertical room reserved above the showcase photo (the "Náhodný 🍀 #id"
 *  title) when deciding whether the upright portrait fits. */
const SHOWCASE_TALL_MARGIN_PX = 64;

export function photoDisplay(
  width: number | null | undefined,
  height: number | null | undefined,
  {
    rotate,
    maxVh = MAX_VH,
    fill = false,
    minWidthPx,
    landscapeOnTall = false,
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
    /** Home showcase only: emit {@link TallRotate} so a full-width tall
     *  portrait flips to landscape on short-but-wide windows instead of
     *  overflowing. No effect anywhere it isn't passed. */
    landscapeOnTall?: boolean;
  },
): PhotoDisplay | null {
  if (!width || !height) return null;
  const landscape = rotate && width > height;
  const displayWidth = landscape ? height : width;
  const displayHeight = landscape ? width : height;
  // Native displayed width: native px, height-capped to `maxVh` of the
  // viewport. This drives the PHOTO + map + facts — wide photos unchanged,
  // narrow photos left as-is (never upscaled).
  // The height cap goes through a `--photo-max-vh` custom property (defaulting
  // to `maxVh`vh) so a short-but-wide viewport — a phone held landscape — can
  // relax it via one media query (see globals.css) instead of leaving the
  // portrait photo squeezed into 70vh of a 390px-tall window. Untouched
  // everywhere the property isn't overridden.
  const naturalWidth =
    maxVh == null
      ? `${displayWidth}px`
      : `min(${displayWidth}px, calc(var(--photo-max-vh, ${maxVh}vh) * ${displayWidth} / ${displayHeight}))`;
  const widthCss = fill ? "100%" : `min(100%, ${naturalWidth})`;
  // Nav-bar width: floored at `minWidthPx` so the back link clears the prev/
  // next even when the photo is narrow. The nav has no image, so — unlike the
  // photo — it MAY exceed the native px width. Collapses to `widthCss` for
  // wide photos (already past the floor) and whenever no floor is given.
  const layoutWidthCss =
    fill || minWidthPx == null
      ? widthCss
      : `min(100%, max(${minWidthPx}px, ${naturalWidth}))`;
  // Landscape-flip params (showcase only). The flip fires when the upright
  // full-width portrait (at the capped column width) is taller than the
  // window; then the box turns landscape (aspect swapped) and the IMG rotates
  // iff the original was portrait. altRotated = !landscape covers both:
  // portrait originals rotate to read landscape, landscape originals just drop
  // their portrait rotation.
  const tallRotate: TallRotate | undefined = landscapeOnTall
    ? {
        minWidthPx: 1280,
        maxHeightPx: Math.round(
          (SHOWCASE_MAX_WIDTH_PX * displayHeight) / displayWidth +
            SHOWCASE_TALL_MARGIN_PX,
        ),
        altAspectRatio: `${displayHeight} / ${displayWidth}`,
        altRotated: !landscape,
      }
    : undefined;
  return {
    rotated: landscape,
    displayWidth,
    displayHeight,
    aspectRatio: `${displayWidth} / ${displayHeight}`,
    widthCss,
    layoutWidthCss,
    tallRotate,
  };
}
