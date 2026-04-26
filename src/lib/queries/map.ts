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
  /** Tightly-packed `[lat, lng]` of every non-anonymized find that has
   *  GPS recorded. The /mapa page paints them as tiny clover dots in a
   *  single canvas overlay (interactive only as a density visualisation
   *  — no popups, no clicks). Tuples instead of objects to keep the
   *  initial JSON payload small (17k → ~150 KB gzipped). */
  findCoords: ReadonlyArray<readonly [number, number]>;
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

  const [locRows, coordRows] = await Promise.all([
    prisma.$queryRaw<LocationRow[]>`
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
    `,
    // Per-find coordinates for the canvas density layer. Anonymized
    // finds and finds without GPS are excluded server-side — there's no
    // client filter that could leak them. Returned as an array of
    // `{lat, lng}` rows; we tuple-pack just before serialising.
    prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT ST_Y(coordinates)::float8 AS lat,
             ST_X(coordinates)::float8 AS lng
      FROM finds
      WHERE is_anonymized = false AND coordinates IS NOT NULL
    `,
  ]);

  const visibleRows = locRows.filter((r) => !anonLocIds.has(r.id));

  // Single pass over the visible rows builds two derived structures:
  //
  //   visibleParentsWithPolygon — IDs of parents that own a polygon, so
  //   we can hide their children's polygons later (they'd just stack on
  //   the same area: e.g. RATIBOŘ_POLE001 over its 7 sub-parts 001a–g).
  //   Anonymized parents are absent from visibleRows already, so their
  //   visible children keep their own polygons.
  //
  //   childFindsByParent — sum of every visible child's find count
  //   keyed by parent_id. The popup on the parent's polygon/dot then
  //   reflects the total area's activity (own + sub-parts), not just
  //   the parent's own row which is often zero.
  const visibleParentsWithPolygon = new Set<number>();
  const childFindsByParent = new Map<number, number>();
  for (const r of visibleRows) {
    if (r.polygon_geojson !== null) {
      visibleParentsWithPolygon.add(r.id);
    }
    if (r.parent_id !== null) {
      const c = Number(r.find_count);
      childFindsByParent.set(
        r.parent_id,
        (childFindsByParent.get(r.parent_id) ?? 0) + c,
      );
    }
  }

  const locations: MapLocation[] = visibleRows.map((r) => {
    const hideChildPolygon =
      r.parent_id !== null && visibleParentsWithPolygon.has(r.parent_id);
    const polygon =
      hideChildPolygon || r.polygon_geojson === null
        ? null
        : (JSON.parse(r.polygon_geojson) as GeoJSON.Polygon);
    // Parent rows fold their visible children's find counts in. Leaves
    // (no children) end up with childFindsByParent.get === undefined →
    // ?? 0 → unchanged. Children themselves keep their own count, so
    // their popup stays correct too.
    const ownCount = Number(r.find_count);
    const findCount = ownCount + (childFindsByParent.get(r.id) ?? 0);
    return {
      id: r.id,
      code: r.code,
      displayName: r.display_name,
      centerLat: r.center_lat,
      centerLng: r.center_lng,
      polygon,
      findCount,
    };
  });

  const findCoords = coordRows.map(
    (r) => [r.lat, r.lng] as readonly [number, number],
  );

  return { locations, findCoords };
}
