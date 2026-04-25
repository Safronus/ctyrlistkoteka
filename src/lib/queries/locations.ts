/**
 * Server-side queries for the /lokality listing.
 *
 * Stats per location (counts, year range, state breakdown, yearly bins,
 * first-find link) are precomputed for the whole filtered list in three
 * batched raw-SQL queries so the inline expansion panel can render
 * straight from the server payload — no extra fetch on click.
 */

import { FindState, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isFormerLocation } from "@/lib/locationCode";
import { paddedIdMatches, parseIdQuery } from "@/lib/search";

export type LocationSort = "id" | "code" | "finds";

export interface LocationStats {
  total: number;
  anonymized: number;
  firstYear: number | null;
  lastYear: number | null;
  /** ISO string of the earliest find at this location, or null when
   *  no finds carry a recorded date. Used by the detail panel to show
   *  "Datum prvního nálezu" + relative time since. */
  firstFoundAt: string | null;
  /** ISO string of the latest find at this location. Mirrors
   *  firstFoundAt for "Datum posledního nálezu". */
  lastFoundAt: string | null;
  firstFindId: number | null;
  /** ID of the latest find at this location (by id, mirroring
   *  firstFindId). Used by the detail panel's "Poslední nález" link. */
  lastFindId: number | null;
  states: Array<{ state: FindState; count: number }>;
  yearly: Array<{ year: number; count: number }>;
}

export interface LocationListItem {
  id: number;
  code: string;
  displayName: string;
  cadastralArea: string;
  locationType: string | null;
  thumbnailUrl: string | null;
  /** True when every location-map row for this Location is anonymized
   *  (and at least one exists). Identifying fields are then hidden in
   *  the UI just like for anonymized finds. */
  isAnonymized: boolean;
  /** True when the location-map filename starts with "NEEXISTUJE-",
   *  marking the place as vanished/former. */
  isGone: boolean;
  /** Polygon area in square meters when a polygon is recorded, otherwise
   *  null. Computed via PostGIS ST_Area on the geography casting so the
   *  number is real m² rather than square degrees. */
  polygonAreaM2: number | null;
  /** GPS center point recorded in the location-map filename (decoded from
   *  ST_Y/ST_X of center_point). Null when the location has no recorded
   *  center yet. */
  coordinates: { lat: number; lng: number } | null;
  stats: LocationStats;
}

export interface LocationFilter {
  q?: string;
  cadastralArea?: string;
  sort?: LocationSort;
  /** When false, locations whose every map is anonymized are dropped from
   *  the result. Default is `false` (hidden). */
  showAnonymized?: boolean;
  /** When false, locations whose code starts with `NEEXISTUJE-` are
   *  dropped from the result. Default is `false` (hidden). */
  showGone?: boolean;
}

/** Returns the alphabetic list of distinct cadastral areas for the city
 *  filter dropdown. */
export async function listCadastralAreas(): Promise<string[]> {
  const rows = await prisma.location.findMany({
    distinct: ["cadastralArea"],
    select: { cadastralArea: true },
    orderBy: { cadastralArea: "asc" },
  });
  return rows.map((r) => r.cadastralArea).filter((v) => v.length > 0);
}

const EMPTY_STATS: LocationStats = {
  total: 0,
  anonymized: 0,
  firstYear: null,
  lastYear: null,
  firstFoundAt: null,
  lastFoundAt: null,
  firstFindId: null,
  lastFindId: null,
  states: [],
  yearly: [],
};

export async function listLocations(
  filter: LocationFilter,
): Promise<LocationListItem[]> {
  // ------------------------------------------------------------ filter
  const where: Prisma.LocationWhereInput = {};
  if (filter.cadastralArea) where.cadastralArea = filter.cadastralArea;
  if (filter.q && filter.q.trim()) {
    const q = filter.q.trim();
    const or: Prisma.LocationWhereInput[] = [
      { code: { contains: q, mode: "insensitive" } },
      { displayName: { contains: q, mode: "insensitive" } },
      { cadastralArea: { contains: q, mode: "insensitive" } },
    ];
    // Numeric input (e.g. "1", "0001", "#00001") additionally matches the
    // location's display ID — both as an exact integer and as a substring
    // of the zero-padded form, so "0001" finds #00001 *and* #00010-#00019.
    // Padded-substring lookup costs one extra small query against the
    // ~128-row locations table; cheap, and consistent with the find search.
    const idQuery = parseIdQuery(q);
    if (idQuery !== null) {
      or.push({ id: idQuery.exactId });
      const idRows = await prisma.location.findMany({ select: { id: true } });
      const padded = idRows
        .map((r) => r.id)
        .filter((id) => paddedIdMatches(id, idQuery.digits));
      if (padded.length > 0) or.push({ id: { in: padded } });
    }
    where.OR = or;
  }

  const locations = await prisma.location.findMany({
    where,
    select: {
      id: true,
      code: true,
      displayName: true,
      cadastralArea: true,
      locationType: true,
    },
    orderBy: { id: "asc" },
  });

  if (locations.length === 0) return [];

  const ids = locations.map((l) => l.id);

  // ------------------------------------------------------------ thumbnails + anonymization status
  // A single anonymized map is enough to flag the whole location — we
  // err on the side of privacy: if even one of a location's maps was
  // marked anonymized in metadata, none of that location's data can be
  // surfaced publicly. A public thumbnail is only ever picked from a
  // map that itself isn't anonymized.
  const maps = await prisma.locationMap.findMany({
    where: { locationId: { in: ids } },
    select: { locationId: true, imagePath: true, isAnonymized: true },
    orderBy: [{ locationId: "asc" }, { id: "asc" }],
  });
  const thumbByLoc = new Map<number, string>();
  const hasAnonymizedMap = new Set<number>();
  for (const m of maps) {
    if (m.isAnonymized) {
      hasAnonymizedMap.add(m.locationId);
      continue;
    }
    if (!thumbByLoc.has(m.locationId)) {
      thumbByLoc.set(m.locationId, m.imagePath);
    }
  }
  const isAnonymizedLoc = (locId: number) => hasAnonymizedMap.has(locId);

  // ------------------------------------------------------------ polygon areas + center coords (PostGIS)
  const geoRows = await prisma.$queryRaw<
    Array<{
      id: number;
      area_m2: number | null;
      center_lat: number | null;
      center_lng: number | null;
    }>
  >`
    SELECT id,
           CASE WHEN polygon IS NOT NULL
                THEN ST_Area(polygon::geography)
                ELSE NULL
           END AS area_m2,
           ST_Y(center_point)::float8 AS center_lat,
           ST_X(center_point)::float8 AS center_lng
    FROM "locations"
    WHERE id IN (${Prisma.join(ids)})
  `;
  const areaByLoc = new Map<number, number>();
  const coordsByLoc = new Map<number, { lat: number; lng: number }>();
  for (const r of geoRows) {
    if (r.area_m2 !== null && Number.isFinite(r.area_m2)) {
      areaByLoc.set(r.id, r.area_m2);
    }
    if (
      r.center_lat !== null &&
      r.center_lng !== null &&
      Number.isFinite(r.center_lat) &&
      Number.isFinite(r.center_lng)
    ) {
      coordsByLoc.set(r.id, { lat: r.center_lat, lng: r.center_lng });
    }
  }

  // ------------------------------------------------------------ aggregates (totals + year range + first find)
  const totalsRows = await prisma.$queryRaw<
    Array<{
      location_id: number;
      total: bigint;
      anonymized: bigint;
      first_year: number | null;
      last_year: number | null;
      first_found_at: Date | null;
      last_found_at: Date | null;
      first_find_id: number | null;
      last_find_id: number | null;
    }>
  >`
    SELECT
      l.id AS location_id,
      COUNT(f.id) AS total,
      COUNT(*) FILTER (WHERE f.is_anonymized = true) AS anonymized,
      EXTRACT(YEAR FROM MIN(f.found_at))::int AS first_year,
      EXTRACT(YEAR FROM MAX(f.found_at))::int AS last_year,
      MIN(f.found_at) AS first_found_at,
      MAX(f.found_at) AS last_found_at,
      MIN(f.id) AS first_find_id,
      MAX(f.id) AS last_find_id
    FROM "locations" l
    LEFT JOIN "finds" f ON f.location_id = l.id
    WHERE l.id IN (${Prisma.join(ids)})
    GROUP BY l.id
  `;
  const totalsByLoc = new Map<number, LocationStats>();
  for (const r of totalsRows) {
    totalsByLoc.set(r.location_id, {
      total: Number(r.total),
      anonymized: Number(r.anonymized),
      firstYear: r.first_year ?? null,
      lastYear: r.last_year ?? null,
      firstFoundAt: r.first_found_at ? r.first_found_at.toISOString() : null,
      lastFoundAt: r.last_found_at ? r.last_found_at.toISOString() : null,
      firstFindId: r.first_find_id ?? null,
      lastFindId: r.last_find_id ?? null,
      states: [],
      yearly: [],
    });
  }

  // ------------------------------------------------------------ state breakdown
  const stateRows = await prisma.$queryRaw<
    Array<{ location_id: number; state: FindState; count: bigint }>
  >`
    SELECT f.location_id, fsa.state, COUNT(*) AS count
    FROM "find_state_assignments" fsa
    JOIN "finds" f ON f.id = fsa.find_id
    WHERE f.location_id IN (${Prisma.join(ids)})
    GROUP BY f.location_id, fsa.state
    ORDER BY f.location_id, count DESC
  `;
  for (const r of stateRows) {
    const entry = totalsByLoc.get(r.location_id);
    if (entry) {
      entry.states.push({ state: r.state, count: Number(r.count) });
    }
  }

  // ------------------------------------------------------------ yearly bins
  const yearlyRows = await prisma.$queryRaw<
    Array<{ location_id: number; year: number; count: bigint }>
  >`
    SELECT
      f.location_id,
      EXTRACT(YEAR FROM f.found_at)::int AS year,
      COUNT(*) AS count
    FROM "finds" f
    WHERE f.location_id IN (${Prisma.join(ids)}) AND f.found_at IS NOT NULL
    GROUP BY f.location_id, year
    ORDER BY f.location_id, year
  `;
  for (const r of yearlyRows) {
    const entry = totalsByLoc.get(r.location_id);
    if (entry) {
      entry.yearly.push({ year: r.year, count: Number(r.count) });
    }
  }

  // ------------------------------------------------------------ assemble
  // Anonymization is enforced HERE — once a location is flagged, the
  // payload sent to the client carries only id + code + the two flags.
  // Description, cadastral area, location type, polygon area, GPS, the
  // map thumbnail, and every aggregated stat are stripped server-side
  // so a frontend bug can never accidentally render them.
  let items: LocationListItem[] = locations.map((l) => {
    const gone = isFormerLocation(l.code);
    if (isAnonymizedLoc(l.id)) {
      return {
        id: l.id,
        code: l.code,
        displayName: "",
        cadastralArea: "",
        locationType: null,
        thumbnailUrl: null,
        isAnonymized: true,
        isGone: gone,
        polygonAreaM2: null,
        coordinates: null,
        stats: EMPTY_STATS,
      };
    }
    return {
      id: l.id,
      code: l.code,
      displayName: l.displayName,
      cadastralArea: l.cadastralArea,
      locationType: l.locationType,
      thumbnailUrl: thumbByLoc.get(l.id) ?? null,
      isAnonymized: false,
      isGone: gone,
      polygonAreaM2: areaByLoc.get(l.id) ?? null,
      coordinates: coordsByLoc.get(l.id) ?? null,
      stats: totalsByLoc.get(l.id) ?? EMPTY_STATS,
    };
  });

  // ------------------------------------------------------------ visibility filters
  // Both default to hidden — anonymized and former-locations clutter the
  // common case where a visitor wants to browse active places.
  if (filter.showAnonymized !== true) {
    items = items.filter((it) => !it.isAnonymized);
  }
  if (filter.showGone !== true) {
    items = items.filter((it) => !it.isGone);
  }

  // ------------------------------------------------------------ sort
  // `finds` is the default — most-active locations float to the top,
  // matching what visitors usually want. `code` is locale-aware
  // (Czech collation); `id` keeps the historical ordering.
  // Anonymized rows have stats=0 so they fall to the bottom under
  // `finds` sort, which is fine: their counts are private.
  const sort: LocationSort = filter.sort ?? "finds";
  if (sort === "code") {
    const collator = new Intl.Collator("cs", { sensitivity: "base" });
    items.sort((a, b) => collator.compare(a.code, b.code));
  } else if (sort === "id") {
    items.sort((a, b) => a.id - b.id);
  } else {
    items.sort(
      (a, b) => b.stats.total - a.stats.total || a.id - b.id,
    );
  }

  return items;
}
