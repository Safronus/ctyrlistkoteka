/**
 * Geometry for the web-drawn map overlays (marker / radius / polygon) that
 * replace the desktop app's baked "Rendered" maps. The web ships the clean
 * "Nosná" PNG and draws the indicator itself, in vector, so it stays crisp
 * and theme-aware on every surface (find detail, location detail, list
 * thumbnails).
 *
 * Everything is precomputed server-side into IMAGE FRACTIONS [0..1] so the
 * client component is a dumb, dependency-free SVG renderer and the payload
 * stays tiny (a handful of floats even for a thumbnail). The positioning is
 * the same equirectangular interpolation `computeMarker()` uses for the
 * find pin — sub-pixel error at sub-km map sizes (Web Mercator nonlinearity
 * is negligible there), and consistent with where the find marker lands.
 */

/** `[[swLat, swLng], [neLat, neLng]]`, as produced by computeMapBounds(). */
export type ImageBounds = [[number, number], [number, number]];

export type MapIndicator = "polygon" | "radius" | "dot";

export interface MapOverlayGeometry {
  indicator: MapIndicator;
  /** Location centre as an image fraction — the radius-circle centre and,
   *  for dot/radius maps, where the centre pin sits. Null when off-image. */
  center: { x: number; y: number } | null;
  /** AOI polygon ring as image fractions (not necessarily clipped to
   *  [0,1] — the client clips via the SVG viewport). Null unless polygon. */
  polygon: Array<{ x: number; y: number }> | null;
  /** Radius as a fraction of image width (rx) and height (ry) — an ellipse
   *  in fraction space that renders as a true circle in the W:H viewBox
   *  (metres-per-pixel is isotropic, but width ≠ height px). Null unless
   *  the indicator is radius. */
  radius: { rx: number; ry: number } | null;
  /** Former/gone location — the client paints the indicator in the "gone"
   *  (rose + hatch) treatment instead of the normal red/green. */
  isGone: boolean;
}

const METERS_PER_DEG_LAT = 111_320;

function isFiniteBounds(b: ImageBounds): boolean {
  const [[swLat, swLng], [neLat, neLng]] = b;
  return (
    Number.isFinite(swLat) &&
    Number.isFinite(swLng) &&
    Number.isFinite(neLat) &&
    Number.isFinite(neLng) &&
    neLat !== swLat &&
    neLng !== swLng
  );
}

/** (lat, lng) → image fraction {x, y}. y is flipped (north = top). */
export function latLngToFrac(
  lat: number,
  lng: number,
  bounds: ImageBounds,
): { x: number; y: number } {
  const [[swLat, swLng], [neLat, neLng]] = bounds;
  return {
    x: (lng - swLng) / (neLng - swLng),
    y: 1 - (lat - swLat) / (neLat - swLat),
  };
}

/** Parse the DB `image_bounds` JSON (unknown shape) into ImageBounds. */
export function parseImageBounds(raw: unknown): ImageBounds | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [sw, ne] = raw as [unknown, unknown];
  if (!Array.isArray(sw) || sw.length !== 2) return null;
  if (!Array.isArray(ne) || ne.length !== 2) return null;
  const b: ImageBounds = [
    [Number(sw[0]), Number(sw[1])],
    [Number(ne[0]), Number(ne[1])],
  ];
  return isFiniteBounds(b) ? b : null;
}

/** First ring of a `ST_AsGeoJSON(polygon)` string as [lng, lat] pairs, or
 *  null when absent/degenerate. Shared by the detail + find-detail queries. */
export function ringFromGeoJson(
  polygonGeoJson: string | null | undefined,
): Array<readonly [number, number]> | null {
  if (!polygonGeoJson) return null;
  try {
    const gj = JSON.parse(polygonGeoJson) as GeoJSON.Polygon;
    const ring = gj.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;
    const pts = ring
      .map((pt) => [Number(pt[0]), Number(pt[1])] as const)
      .filter(
        (pt): pt is readonly [number, number] =>
          Number.isFinite(pt[0]) && Number.isFinite(pt[1]),
      );
    return pts.length >= 3 ? pts : null;
  } catch {
    return null;
  }
}

/** Indicator kind from the presence of a polygon ring / effective radius,
 *  matching the desktop generator's priority polygon > radius > dot. */
export function indicatorFrom(
  ring: ReadonlyArray<unknown> | null,
  effRadiusM: number | null,
): MapIndicator {
  if (ring && ring.length >= 3) return "polygon";
  return effRadiusM && effRadiusM > 0 ? "radius" : "dot";
}

export interface OverlayInput {
  indicator: MapIndicator;
  imageBounds: ImageBounds;
  centerLat: number | null;
  centerLng: number | null;
  /** Radius in metres (indicator = radius only). */
  radiusM: number | null;
  /** AOI polygon ring as [lng, lat] pairs (GeoJSON order). */
  polygonLngLat: ReadonlyArray<readonly [number, number]> | null;
  isGone: boolean;
}

/**
 * Builds the overlay geometry for one location map, or null when there's
 * nothing to draw (no usable bounds, or a polygon indicator with no ring).
 */
export function computeMapOverlayGeometry(
  input: OverlayInput,
): MapOverlayGeometry | null {
  const { imageBounds: bounds } = input;
  if (!isFiniteBounds(bounds)) return null;

  const center =
    input.centerLat !== null && input.centerLng !== null
      ? latLngToFrac(input.centerLat, input.centerLng, bounds)
      : null;

  if (input.indicator === "polygon") {
    if (!input.polygonLngLat || input.polygonLngLat.length < 3) return null;
    const polygon = input.polygonLngLat.map(([lng, lat]) =>
      latLngToFrac(lat, lng, bounds),
    );
    return { indicator: "polygon", center, polygon, radius: null, isGone: input.isGone };
  }

  if (input.indicator === "radius") {
    if (center === null || input.radiusM === null || input.radiusM <= 0) {
      // No radius to draw — fall back to a bare dot so the centre is still
      // marked rather than showing nothing.
      return { indicator: "dot", center, polygon: null, radius: null, isGone: input.isGone };
    }
    const [[swLat, swLng], [neLat, neLng]] = bounds;
    const centerLatRad = ((input.centerLat ?? 0) * Math.PI) / 180;
    const widthM = (neLng - swLng) * METERS_PER_DEG_LAT * Math.cos(centerLatRad);
    const heightM = (neLat - swLat) * METERS_PER_DEG_LAT;
    const radius =
      widthM > 0 && heightM > 0
        ? { rx: input.radiusM / widthM, ry: input.radiusM / heightM }
        : null;
    return { indicator: "radius", center, polygon: null, radius, isGone: input.isGone };
  }

  // dot
  return { indicator: "dot", center, polygon: null, radius: null, isGone: input.isGone };
}
