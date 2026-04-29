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
import { isFormerLocation } from "@/lib/locationCode";

export interface MapLocation {
  id: number;
  code: string;
  displayName: string;
  /** Parent location ID when this row is a sub-part (e.g.
   *  RATIBOŘ_POLE001a's parent is RATIBOŘ_POLE001), otherwise null. The
   *  client uses this to decide whether a polygon is "default-hidden"
   *  — child polygons stay off until the user opts them in via the
   *  sidebar toggle, since they'd otherwise stack on the parent's. */
  parentId: number | null;
  /** True when the location code starts with `NEEXISTUJE-`, marking the
   *  place as physically gone. The map paints these polygons + dots in
   *  red with diagonal hatching so visitors can spot vanished places at
   *  a glance instead of mistaking them for active spots. */
  isGone: boolean;
  centerLat: number | null;
  centerLng: number | null;
  polygon: GeoJSON.Polygon | null;
  findCount: number;
}

export interface MapData {
  locations: MapLocation[];
  /** Tightly-packed `[lat, lng, locationId]` of every non-anonymized
   *  find that has GPS recorded. The /mapa page paints them as tiny
   *  clover dots in a single canvas overlay (interactive only as a
   *  density visualisation — no popups, no clicks). The location id
   *  lets the canvas dim finds outside the currently focused location
   *  to 20 % opacity so the active spot's clovers stand out. Finds
   *  without a location use 0. Tuples instead of objects to keep the
   *  payload small. */
  findCoords: ReadonlyArray<readonly [number, number, number]>;
  /** Total find count in the DB. Used by the Vrstvy card to surface
   *  the gap between "what /sbirka shows" and "what's on the map" —
   *  anonymized finds and finds without GPS never enter `findCoords`,
   *  so their absence on the map needs a one-line explanation. */
  findCountTotal: number;
  /** Number of locations whose every map carries the is_anonymized
   *  flag. Hidden from /mapa entirely; the sidebar header surfaces the
   *  count so visitors know there are private spots they can't browse. */
  anonymizedLocationCount: number;
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
    // client filter that could leak them. Returned as `{lat, lng, lid}`
    // rows; we tuple-pack just before serialising. `lid` is 0 for finds
    // without a location so the canvas can use a single typed-array.
    prisma.$queryRaw<
      Array<{ lat: number; lng: number; lid: number | null }>
    >`
      SELECT ST_Y(coordinates)::float8 AS lat,
             ST_X(coordinates)::float8 AS lng,
             location_id AS lid
      FROM finds
      WHERE is_anonymized = false AND coordinates IS NOT NULL
    `,
  ]);

  const visibleRows = locRows.filter((r) => !anonLocIds.has(r.id));

  // Sum of every visible child's find count keyed by parent_id. The
  // popup on the parent's polygon/dot then reflects the total area's
  // activity (own + sub-parts), not just the parent's own row which is
  // often zero. Children keep their own count.
  const childFindsByParent = new Map<number, number>();
  for (const r of visibleRows) {
    if (r.parent_id !== null) {
      const c = Number(r.find_count);
      childFindsByParent.set(
        r.parent_id,
        (childFindsByParent.get(r.parent_id) ?? 0) + c,
      );
    }
  }

  // We send every available polygon — including children of polygon
  // parents — so the client can opt-in via the sidebar toggle. Default
  // child-polygon hiding now lives in the client (see MapaShell), and
  // can be overridden per-row or pre-seeded by `?focus=<child>` deep
  // links from /statistiky.
  const locations: MapLocation[] = visibleRows.map((r) => {
    const polygon =
      r.polygon_geojson === null
        ? null
        : (JSON.parse(r.polygon_geojson) as GeoJSON.Polygon);
    const ownCount = Number(r.find_count);
    const findCount = ownCount + (childFindsByParent.get(r.id) ?? 0);
    return {
      id: r.id,
      code: r.code,
      displayName: r.display_name,
      parentId: r.parent_id,
      isGone: isFormerLocation(r.code),
      centerLat: r.center_lat,
      centerLng: r.center_lng,
      polygon,
      findCount,
    };
  });

  const findCoords = coordRows.map(
    (r) =>
      [r.lat, r.lng, r.lid ?? 0] as readonly [number, number, number],
  );

  // Total finds + anonymized location count let the Vrstvy card and
  // sidebar header explain the "missing on map vs total" gap that a
  // visitor would otherwise read as a bug.
  const findCountTotal = await prisma.find.count();

  return {
    locations,
    findCoords,
    findCountTotal,
    anonymizedLocationCount: anonLocIds.size,
  };
}
