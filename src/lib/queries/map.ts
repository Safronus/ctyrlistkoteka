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

import { FIND_DEVIATION_RADIUS_M } from "@/lib/constants";
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
  /** Child locations only: when true the polygon overlays the parent
   *  on /mapa by default (no sidebar opt-in needed). Set from the
   *  `{ "code": ..., "map": true }` form in LokaceHierarchie.json via
   *  sync. Always false for top-level locations. */
  showOnMapByDefault: boolean;
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
  /** Tightly-packed `[lat, lng, locationId, findId, deviated]` of
   *  every non-anonymized find that has GPS recorded. The /mapa page
   *  paints them as tiny clover dots in a single canvas overlay
   *  (interactive only as a density visualisation — no popups, no
   *  clicks).
   *
   *  Slot meanings:
   *   - [0] lat, [1] lng — placement
   *   - [2] locationId   — dim by focus-location (0 for findings without
   *                        a location)
   *   - [3] findId       — dim by /sbirka filter (which IDs match the
   *                        user's narrowing)
   *   - [4] deviated     — 1 when the find's GPS falls outside its
   *                        location's polygon, or beyond
   *                        FIND_DEVIATION_RADIUS_M of the centre for
   *                        polygon-less locations. 0 otherwise (or for
   *                        finds without a location). Drives the
   *                        "Skrýt odchýlené nálezy" sub-toggle under
   *                        Nálezy in the Vrstvy panel.
   *
   *  Tuples instead of objects keep the payload small (5×17k floats ≈
   *  680 KB pre-gzip), and the canvas reads them by index. */
  findCoords: ReadonlyArray<
    readonly [number, number, number, number, number]
  >;
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
    show_on_map_by_default: boolean;
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
             l.show_on_map_by_default,
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
    // client filter that could leak them. Returned as `{lat, lng,
    // lid, fid, deviated}` rows; we tuple-pack just before serialising.
    //
    // `deviated` flag: 1 when the find sits OUTSIDE the location's
    // polygon (ST_Covers false), or further than
    // FIND_DEVIATION_RADIUS_M metres from the centre for polygon-less
    // locations. Polygon-bearing locations dominate the dataset, so
    // the LEFT JOIN + CASE only adds one nested-loop predicate per
    // find — fast enough not to need denormalisation. Finds with no
    // location_id (and so no expectation of "at the location") map to
    // 0.
    prisma.$queryRaw<
      Array<{
        lat: number;
        lng: number;
        lid: number | null;
        fid: number;
        deviated: boolean;
      }>
    >`
      SELECT ST_Y(f.coordinates)::float8 AS lat,
             ST_X(f.coordinates)::float8 AS lng,
             f.location_id AS lid,
             f.id AS fid,
             CASE
               WHEN l.polygon IS NOT NULL THEN
                 NOT ST_Covers(l.polygon::geography, f.coordinates::geography)
               WHEN l.center_point IS NOT NULL THEN
                 ST_DistanceSphere(f.coordinates, l.center_point)
                   > ${FIND_DEVIATION_RADIUS_M}
               ELSE
                 false
             END AS deviated
      FROM finds f
      LEFT JOIN locations l ON l.id = f.location_id
      WHERE f.is_anonymized = false AND f.coordinates IS NOT NULL
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
      showOnMapByDefault: r.show_on_map_by_default,
      isGone: isFormerLocation(r.code),
      centerLat: r.center_lat,
      centerLng: r.center_lng,
      polygon,
      findCount,
    };
  });

  const findCoords = coordRows.map(
    (r) =>
      [r.lat, r.lng, r.lid ?? 0, r.fid, r.deviated ? 1 : 0] as readonly [
        number,
        number,
        number,
        number,
        number,
      ],
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
