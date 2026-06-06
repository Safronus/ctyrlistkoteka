/**
 * Czech regions (kraje) dataset for the /statistiky "by region" map mode.
 *
 * Source: Natural Earth 10m admin-1 (public domain), filtered to the 14
 * CZ kraje, coordinates rounded to ~11 m and re-labelled with proper
 * Czech names. Bundled as a small GeoJSON in src/lib/data/cz-kraje.json.
 * Used only server-side (the choropleth is a server-rendered SVG, like
 * the world map), so it never ships to the client.
 *
 * The join key is the ISO 3166-2 code (e.g. "CZ-ZL"), stable + unique.
 */

import type {
  Feature,
  FeatureCollection,
  Geometry,
  Position,
} from "geojson";
import rawData from "@/lib/data/cz-kraje.json";

export interface CzRegionProps {
  /** ISO 3166-2 code, e.g. "CZ-ZL". Doubles as the choropleth join key. */
  id: string;
  /** Czech display name, e.g. "Zlínský kraj". */
  name: string;
}

export type CzRegionsFC = FeatureCollection<Geometry, CzRegionProps>;

let cached: CzRegionsFC | null = null;

export function getCzRegions(): CzRegionsFC {
  if (!cached) cached = rawData as unknown as CzRegionsFC;
  return cached;
}

export interface CzRegionRef {
  /** ISO 3166-2 code — matches CzRegionProps.id / the choropleth key. */
  code: string;
  name: string;
}

/** All linear rings of a (Multi)Polygon flattened into one list. Kraje
 *  don't overlap, so a single even-odd pass over every ring (outer rings
 *  + holes, e.g. Praha carved out of Středočeský kraj) yields the correct
 *  contains result. */
function allRings(geom: Geometry): Position[][] {
  if (geom.type === "Polygon") return geom.coordinates;
  if (geom.type === "MultiPolygon") return geom.coordinates.flat();
  return [];
}

/** Even-odd ray casting across every ring; coords are [lng, lat]. */
function ringsContain(rings: Position[][], lng: number, lat: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i]![0]!;
      const yi = ring[i]![1]!;
      const xj = ring[j]![0]!;
      const yj = ring[j]![1]!;
      const intersect =
        yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
  }
  return inside;
}

function bboxArea(rings: Position[][]): number {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const ring of rings)
    for (const [x, y] of ring) {
      if (x! < minX) minX = x!;
      if (x! > maxX) maxX = x!;
      if (y! < minY) minY = y!;
      if (y! > maxY) maxY = y!;
    }
  return (maxX - minX) * (maxY - minY);
}

/**
 * Resolves a GPS point to its Czech region, or null when the point isn't
 * inside any kraj (i.e. outside the Czech Republic). When a point lands
 * inside more than one polygon (only possible at the Praha/Středočeský
 * enclave seam) the smallest region wins, so central-Prague finds resolve
 * to Praha rather than the surrounding kraj.
 */
export function czRegionFromCoords(
  lat: number,
  lng: number,
): CzRegionRef | null {
  const fc = getCzRegions();
  let best: { ref: CzRegionRef; area: number } | null = null;
  for (const f of fc.features as Feature<Geometry, CzRegionProps>[]) {
    const rings = allRings(f.geometry);
    if (ringsContain(rings, lng, lat)) {
      const area = bboxArea(rings);
      if (!best || area < best.area) {
        best = { ref: { code: f.properties.id, name: f.properties.name }, area };
      }
    }
  }
  return best?.ref ?? null;
}
