/**
 * US states dataset for the /statistiky "by US state" map mode — the
 * American counterpart of `cz-regions.ts`, and bundled the same way.
 *
 * Source: the `us-atlas` package (US Census cartographic boundaries,
 * public domain), filtered to the 50 states + DC, converted from TopoJSON
 * to GeoJSON and rounded to ~11 m, then committed as a small static file
 * at `src/lib/data/us-states.json`. We bundle the finished GeoJSON rather
 * than depending on `us-atlas` at runtime — exactly like `cz-kraje.json` —
 * because that package drags in a whole shapefile/topojson build tree
 * (including long-deprecated transitive deps) for what is, to us, one
 * static data file. To regenerate if the source ever changes: temporarily
 * `pnpm add -D us-atlas`, then in a tsx one-off `feature()` its
 * `states-10m.json`, drop the five territory FIPS below, round coords to
 * 4 decimals, write the FeatureCollection to the JSON, and `pnpm remove
 * us-atlas` again.
 *
 * Used only server-side: as a GPS → state resolver (`usStateFromCoords`,
 * like `czRegionFromCoords`) and to draw the server-rendered choropleth
 * SVG. Never ships to the client.
 *
 * The join key is the 2-digit FIPS state code (e.g. "06" = California),
 * stable + unique. The five island territories the source also carries
 * (American Samoa, Guam, N. Mariana Is., Puerto Rico, US Virgin Is.) are
 * already dropped from the file: `geoAlbersUsa` has no inset for them and
 * the map is about the 50 states + DC.
 */

import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import rawData from "@/lib/data/us-states.json";

export interface UsStateProps {
  /** 2-digit FIPS code, e.g. "06". Doubles as the choropleth join key. */
  id: string;
  /** English state name, e.g. "California". */
  name: string;
}

export type UsStatesFC = FeatureCollection<Geometry, UsStateProps>;

let cached: UsStatesFC | null = null;

/** Returns the 50 states + DC as a GeoJSON FeatureCollection. */
export function getUsStates(): UsStatesFC {
  if (!cached) cached = rawData as unknown as UsStatesFC;
  return cached;
}

export interface UsStateRef {
  /** FIPS code — matches UsStateProps.id / the choropleth key. */
  code: string;
  name: string;
}

/** All linear rings of a (Multi)Polygon flattened into one list. */
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
 * Resolves a GPS point to its US state (50 + DC), or null when the point
 * isn't inside any of them. Called only after `countryFromCoords` has
 * already placed the point in the USA, so it never runs for a Czech find.
 * On the rare overlap at a shared border the smallest polygon wins — the
 * same tie-break `czRegionFromCoords` uses for the Praha enclave.
 */
export function usStateFromCoords(lat: number, lng: number): UsStateRef | null {
  const fc = getUsStates();
  let best: { ref: UsStateRef; area: number } | null = null;
  for (const f of fc.features as Feature<Geometry, UsStateProps>[]) {
    const rings = allRings(f.geometry);
    if (ringsContain(rings, lng, lat)) {
      const area = bboxArea(rings);
      if (!best || area < best.area) {
        best = {
          ref: { code: f.properties.id, name: f.properties.name },
          area,
        };
      }
    }
  }
  return best?.ref ?? null;
}
