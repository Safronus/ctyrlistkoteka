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

/**
 * Returns the most likely country for the given lat/lng. Falls back to
 * `{ code: "??", name: "Jinde" }` for points in international waters or
 * inside the gaps that the 110m simplification leaves between coastal
 * countries.
 */
export function countryFromCoords(lat: number, lng: number): CountryRef {
  const fc = getWorldCountries();
  for (const f of fc.features) {
    if (geometryContains(f.geometry, lng, lat)) {
      const props = f.properties;
      return {
        code: props.id || "??",
        name: czechCountryName(props.name) || props.name || UNKNOWN.name,
      };
    }
  }
  return UNKNOWN;
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
