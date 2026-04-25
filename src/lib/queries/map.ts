/**
 * Map data query. Returns the locations layer for /mapa — every
 * non-anonymized location with its polygon (GeoJSON, optional) and
 * centre point. Find markers and PNG overlays both used to live here;
 * the page no longer renders them (markers added clutter, PNG overlays
 * baked rendered text/scale labels into the OSM canvas), so their
 * queries were removed.
 *
 * Anonymization is applied here per CLAUDE.md §6 — anonymized
 * locations never make it into the public payload.
 */

import { prisma } from "@/lib/db";

export interface MapLocation {
  id: number;
  code: string;
  displayName: string;
  centerLat: number | null;
  centerLng: number | null;
  polygon: GeoJSON.Polygon | null;
  findCount: number;
}

export interface MapData {
  locations: MapLocation[];
}

export async function getMapData(): Promise<MapData> {
  // A location is anonymized if at least one of its maps carries the
  // is_anonymized flag (matching /lokality logic).
  const anonLocRows = await prisma.locationMap.findMany({
    where: { isAnonymized: true },
    select: { locationId: true },
    distinct: ["locationId"],
  });
  const anonLocIds = new Set(anonLocRows.map((r) => r.locationId));

  type LocationRow = {
    id: number;
    code: string;
    display_name: string;
    center_lat: number | null;
    center_lng: number | null;
    polygon_geojson: string | null;
    find_count: bigint;
  };

  const locRows = await prisma.$queryRaw<LocationRow[]>`
    SELECT l.id,
           l.code,
           l.display_name,
           ST_Y(l.center_point)::float8 AS center_lat,
           ST_X(l.center_point)::float8 AS center_lng,
           ST_AsGeoJSON(l.polygon) AS polygon_geojson,
           COUNT(f.id) AS find_count
    FROM locations l
    LEFT JOIN finds f ON f.location_id = l.id
    GROUP BY l.id
  `;

  const locations: MapLocation[] = locRows
    .filter((r) => !anonLocIds.has(r.id))
    .map((r) => ({
      id: r.id,
      code: r.code,
      displayName: r.display_name,
      centerLat: r.center_lat,
      centerLng: r.center_lng,
      polygon: r.polygon_geojson
        ? (JSON.parse(r.polygon_geojson) as GeoJSON.Polygon)
        : null,
      findCount: Number(r.find_count),
    }));

  return { locations };
}
