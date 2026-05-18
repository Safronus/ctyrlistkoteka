/**
 * GPS → country resolver using point-in-polygon against the bundled
 * Natural Earth 110m dataset (see `world-countries.ts`).
 *
 * Earlier versions used a hand-rolled bbox + nearest-centroid heuristic;
 * it produced wrong answers in border regions (Zlín — solidly in CZ —
 * landed inside both the CZ and SK bounding boxes, and SK's centroid
 * was 0.13° closer, so it got tagged Slovakia). Polygon containment is
 * the only honest way to fix that.
 *
 * Polygons in this dataset are ordered (lng, lat). Ray casting walks the
 * outer ring and toggles "inside" whenever an edge crosses a horizontal
 * line through the test point. Holes (subsequent rings of a polygon) are
 * ignored because Natural Earth at 110m resolution doesn't include any
 * country with a hole that's relevant for our data — and even if it did,
 * a wrong "inside" result for a tiny enclave wouldn't materially affect
 * a stats table.
 *
 * Near-coast fallback: the 110m simplification drops small islands and
 * smooths coastlines, so points like Naoshima (a small island in
 * Japan's Seto Inland Sea) fall in the gap between Honshu and Shikoku
 * polygons. When no polygon contains the point we pick the nearest
 * country by minimum vertex distance, but only if it's within
 * NEAR_FALLBACK_KM — far enough to absorb 110m's coastal noise + small
 * islands, tight enough that mid-ocean points stay "Jinde".
 */

import type { Geometry, Position } from "geojson";
import { czechCountryName, getWorldCountries } from "@/lib/world-countries";

export interface CountryRef {
  /** ISO 3166-1 numeric code as a string ("203" = Česko). Doubles as
   *  the join key for the choropleth `Map<countryId, count>`. */
  code: string;
  /** Localized (Czech) display name. */
  name: string;
}

const UNKNOWN: CountryRef = { code: "??", name: "Jinde" };

/** Snap-to-coast threshold for points that aren't inside any polygon.
 *  Sized so that Naoshima (~10 km offshore in 110m simplification) and
 *  comparable small islands resolve to their parent country, while
 *  points hundreds of km out at sea stay unresolved.
 *
 *  100 km also comfortably covers 110m polygon noise along otherwise
 *  unambiguous coastlines (e.g. tidal flats, ria coasts). */
const NEAR_FALLBACK_KM = 100;

/**
 * Returns the most likely country for the given lat/lng. Falls back to
 * `{ code: "??", name: "Jinde" }` for points in international waters
 * more than NEAR_FALLBACK_KM from any country's polygon.
 */
export function countryFromCoords(lat: number, lng: number): CountryRef {
  const fc = getWorldCountries();
  let nearest: { props: { id: string; name: string }; distKm: number } | null =
    null;
  for (const f of fc.features) {
    if (geometryContains(f.geometry, lng, lat)) {
      const props = f.properties;
      return {
        code: props.id || "??",
        name: czechCountryName(props.name) || props.name || UNKNOWN.name,
      };
    }
    const d = minVertexDistanceKm(f.geometry, lat, lng);
    if (d !== null && (!nearest || d < nearest.distKm)) {
      nearest = { props: f.properties, distKm: d };
    }
  }
  if (nearest && nearest.distKm <= NEAR_FALLBACK_KM) {
    return {
      code: nearest.props.id || "??",
      name:
        czechCountryName(nearest.props.name) ||
        nearest.props.name ||
        UNKNOWN.name,
    };
  }
  return UNKNOWN;
}

/** Smallest haversine distance (km) from a point to any vertex of a
 *  geometry. Returns null for unsupported geometry types. We compare
 *  vertex distance rather than edge distance — at 110m resolution
 *  vertices are dense enough (every few km) that the simpler vertex
 *  test produces nearly identical results, and a horizontal-bbox
 *  pre-filter would be more code than it saves at our call volume
 *  (one call per location, cached via React `cache()` for 6 h ISR). */
function minVertexDistanceKm(
  geom: Geometry,
  lat: number,
  lng: number,
): number | null {
  if (geom.type === "Polygon") {
    return minVertexDistanceInPolygon(geom.coordinates, lat, lng);
  }
  if (geom.type === "MultiPolygon") {
    let best: number | null = null;
    for (const poly of geom.coordinates) {
      const d = minVertexDistanceInPolygon(poly, lat, lng);
      if (d !== null && (best === null || d < best)) best = d;
    }
    return best;
  }
  return null;
}

function minVertexDistanceInPolygon(
  rings: Position[][],
  lat: number,
  lng: number,
): number | null {
  let best: number | null = null;
  for (const ring of rings) {
    for (const v of ring) {
      const vLng = v[0];
      const vLat = v[1];
      if (vLng === undefined || vLat === undefined) continue;
      const d = haversineKm(lat, lng, vLat, vLng);
      if (best === null || d < best) best = d;
    }
  }
  return best;
}

const EARTH_RADIUS_KM = 6371.0088;

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function geometryContains(geom: Geometry, x: number, y: number): boolean {
  if (geom.type === "Polygon") {
    return polygonContains(geom.coordinates, x, y);
  }
  if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) {
      if (polygonContains(poly, x, y)) return true;
    }
  }
  return false;
}

function polygonContains(rings: Position[][], x: number, y: number): boolean {
  // First ring is the outer boundary; later rings would be holes — see
  // module comment for why we ignore them.
  const outer = rings[0];
  if (!outer) return false;
  return ringContains(outer, x, y);
}

function ringContains(ring: Position[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i]!;
    const pj = ring[j]!;
    const xi = pi[0]!;
    const yi = pi[1]!;
    const xj = pj[0]!;
    const yj = pj[1]!;
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
