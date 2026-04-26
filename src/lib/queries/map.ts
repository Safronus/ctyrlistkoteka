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
    parent_id: number | null;
    center_lat: number | null;
    center_lng: number | null;
    polygon_geojson: string | null;
    find_count: bigint;
  };

  const locRows = await prisma.$queryRaw<LocationRow[]>`
    SELECT l.id,
           l.code,
           l.display_name,
           l.parent_id,
           ST_Y(l.center_point)::float8 AS center_lat,
           ST_X(l.center_point)::float8 AS center_lng,
           ST_AsGeoJSON(l.polygon) AS polygon_geojson,
           COUNT(f.id) AS find_count
    FROM locations l
    LEFT JOIN finds f ON f.location_id = l.id
    GROUP BY l.id
  `;

  const visibleRows = locRows.filter((r) => !anonLocIds.has(r.id));

  // When a parent location has its own polygon (e.g. RATIBOŘ_POLE001
  // covering its 7 sub-parts 001a–001g), drawing the child polygons on
  // top of it just adds visual noise — the parent already encloses the
  // same area. We collect the set of *visible* parents that have a
  // polygon, then null out any child whose parent is in that set.
  // Anonymized parents are excluded from the set, so their visible
  // children keep their own polygons.
  const visibleParentsWithPolygon = new Set<number>();
  for (const r of visibleRows) {
    if (r.polygon_geojson !== null) {
      visibleParentsWithPolygon.add(r.id);
    }
  }

  const locations: MapLocation[] = visibleRows.map((r) => {
    const hideChildPolygon =
      r.parent_id !== null && visibleParentsWithPolygon.has(r.parent_id);
    const polygon =
      hideChildPolygon || r.polygon_geojson === null
        ? null
        : (JSON.parse(r.polygon_geojson) as GeoJSON.Polygon);
    return {
      id: r.id,
      code: r.code,
      displayName: r.display_name,
      centerLat: r.center_lat,
      centerLng: r.center_lng,
      polygon,
      findCount: Number(r.find_count),
    };
  });

  return { locations };
}
