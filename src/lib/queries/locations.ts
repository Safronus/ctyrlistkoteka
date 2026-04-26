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
import { DEFAULT_LOCATION_ID } from "@/lib/constants";
import { isFormerLocation } from "@/lib/locationCode";
import { paddedIdMatches, parseIdQuery } from "@/lib/search";

/** Sort key. `dist-asc` / `dist-desc` order locations by great-circle
 *  distance from MAP 00001. Anonymized locations have NULL distance
 *  (their coords are private) and fall to the end of distance sorts so
 *  the order can't be used to triangulate them. */
export type LocationSort = "id" | "code" | "finds" | "dist-asc" | "dist-desc";

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
  /** Great-circle distance in metres from MAP 00001's GPS centre to this
   *  location's center_point. Null when the location is anonymized (the
   *  number could leak position), when MAP 00001 isn't on disk, or when
   *  the location has no recorded centre. */
  distanceFromDefault: number | null;
  /** When set, this row is a sub-part of another location (parent_id FK
   *  declared via data/meta/LokaceHierarchie.json). The list view uses
   *  it to indent the row under its parent. */
  parentId: number | null;
  /** How many *visible* sub-parts this location has (i.e. counted after
   *  the showAnonymized / showGone filters). 0 for leaves and for any
   *  non-parent. Used by the "+ N částí" badge in the row header. */
  childCount: number;
  /** Own stats — what's physically attached to this Location row. For a
   *  master location whose finds live entirely on its sub-parts (e.g.
   *  RATIBOŘ_POLE001 with 0 own finds, 953 across 001a–001g) this reads 0.
   *  Use `aggregateStats` instead when displaying the parent's "true"
   *  picture. */
  stats: LocationStats;
  /** Stats folded across this location and every visible sub-part —
   *  totals, year range, first/last find timestamps + IDs, state
   *  breakdown and yearly bins all merged. Equals `stats` for locations
   *  without children, so call sites that don't care about the split can
   *  read `aggregateStats` unconditionally. */
  aggregateStats: LocationStats;
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
      parentId: true,
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
  // We piggy-back the distance-from-MAP-00001 calculation onto this row
  // — the locations table is small (~128 rows) so adding ST_DistanceSphere
  // here costs effectively nothing.
  const geoRows = await prisma.$queryRaw<
    Array<{
      id: number;
      area_m2: number | null;
      center_lat: number | null;
      center_lng: number | null;
      dist_m: number | null;
    }>
  >`
    WITH ref AS (
      SELECT ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326) AS pt
      FROM "location_maps" WHERE id = ${DEFAULT_LOCATION_ID}
    )
    SELECT id,
           CASE WHEN polygon IS NOT NULL
                THEN ST_Area(polygon::geography)
                ELSE NULL
           END AS area_m2,
           ST_Y(center_point)::float8 AS center_lat,
           ST_X(center_point)::float8 AS center_lng,
           CASE WHEN center_point IS NOT NULL
                  AND (SELECT pt FROM ref) IS NOT NULL
                THEN ST_DistanceSphere(center_point, (SELECT pt FROM ref))::float8
           END AS dist_m
    FROM "locations"
    WHERE id IN (${Prisma.join(ids)})
  `;
  const areaByLoc = new Map<number, number>();
  const coordsByLoc = new Map<number, { lat: number; lng: number }>();
  const distByLoc = new Map<number, number>();
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
    if (r.dist_m !== null && Number.isFinite(r.dist_m)) {
      distByLoc.set(r.id, r.dist_m);
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
      // Anonymized locations don't expose their parent link either —
      // surfacing it would reveal which sub-parts belong to a hidden
      // master location, defeating the anonymization.
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
        distanceFromDefault: null,
        parentId: null,
        childCount: 0,
        stats: EMPTY_STATS,
        aggregateStats: EMPTY_STATS,
      };
    }
    const stats = totalsByLoc.get(l.id) ?? EMPTY_STATS;
    // Seed aggregateStats from own stats with fresh arrays — the fold
    // pass below mutates `aggregateStats` so we must not share refs back
    // to `stats` (or to the EMPTY_STATS singleton).
    const aggregateStats: LocationStats = {
      ...stats,
      states: [...stats.states],
      yearly: [...stats.yearly],
    };
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
      distanceFromDefault: distByLoc.get(l.id) ?? null,
      parentId: l.parentId,
      childCount: 0,
      stats,
      aggregateStats,
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

  // ------------------------------------------------------------ hierarchy aggregates
  // Now that the visible set is final, fold every visible child's full
  // stats into its parent so the parent's expanded panel shows the
  // "incl. sub-parts" picture (totals, year range, first/last find,
  // state breakdown). We only count children that are actually in
  // `items` — a child filtered out by showAnonymized/showGone shouldn't
  // influence the parent's badge.
  const byId = new Map(items.map((it) => [it.id, it]));
  for (const item of items) {
    if (item.parentId === null) continue;
    const parent = byId.get(item.parentId);
    if (!parent) continue; // parent filtered out — child stands alone
    parent.childCount += 1;
    foldStats(parent.aggregateStats, item.stats);
  }

  // ------------------------------------------------------------ sort
  // `finds` is the default — most-active locations float to the top,
  // matching what visitors usually want. `code` is locale-aware
  // (Czech collation); `id` keeps the historical ordering.
  // The `finds` sort uses `aggregateStats.total` so a parent with many
  // small sub-parts ranks by its true significance (the sub-parts are
  // then reinserted right under it via interleaveChildren — see below).
  // Anonymized rows have stats=0 so they fall to the bottom under
  // `finds` sort, which is fine: their counts are private.
  const sort: LocationSort = filter.sort ?? "finds";
  if (sort === "code") {
    const collator = new Intl.Collator("cs", { sensitivity: "base" });
    items.sort((a, b) => collator.compare(a.code, b.code));
  } else if (sort === "id") {
    items.sort((a, b) => a.id - b.id);
  } else if (sort === "dist-asc" || sort === "dist-desc") {
    const dir = sort === "dist-asc" ? 1 : -1;
    items.sort((a, b) => {
      const da = a.distanceFromDefault;
      const db = b.distanceFromDefault;
      if (da === null && db === null) return a.id - b.id;
      if (da === null) return 1; // anonymized / no-GPS rows fall to end
      if (db === null) return -1;
      return dir * (da - db);
    });
  } else {
    items.sort(
      (a, b) =>
        b.aggregateStats.total - a.aggregateStats.total || a.id - b.id,
    );
  }

  return interleaveChildren(items);
}

/** Mutates `into` to absorb `from`'s totals, year range, first/last find
 *  and state/yearly bins. Used during the parent/child aggregation pass:
 *  every visible child's stats get folded into the parent's
 *  `aggregateStats` so the expanded panel renders the combined picture
 *  exactly like a regular location's panel — no separate "parent" UI
 *  branch needed downstream. */
function foldStats(into: LocationStats, from: LocationStats): void {
  into.total += from.total;
  into.anonymized += from.anonymized;
  into.firstYear = minNullable(into.firstYear, from.firstYear);
  into.lastYear = maxNullable(into.lastYear, from.lastYear);
  into.firstFoundAt = minIso(into.firstFoundAt, from.firstFoundAt);
  into.lastFoundAt = maxIso(into.lastFoundAt, from.lastFoundAt);
  into.firstFindId = minNullable(into.firstFindId, from.firstFindId);
  into.lastFindId = maxNullable(into.lastFindId, from.lastFindId);

  // States: merge by enum, sum counts, sort by count desc to mirror the
  // ordering the per-location SQL produced.
  const stateMap = new Map<FindState, number>();
  for (const s of into.states) {
    stateMap.set(s.state, (stateMap.get(s.state) ?? 0) + s.count);
  }
  for (const s of from.states) {
    stateMap.set(s.state, (stateMap.get(s.state) ?? 0) + s.count);
  }
  into.states = Array.from(stateMap, ([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count);

  // Yearly bins: merge by year, sum counts, sort by year asc.
  const yearMap = new Map<number, number>();
  for (const y of into.yearly) {
    yearMap.set(y.year, (yearMap.get(y.year) ?? 0) + y.count);
  }
  for (const y of from.yearly) {
    yearMap.set(y.year, (yearMap.get(y.year) ?? 0) + y.count);
  }
  into.yearly = Array.from(yearMap, ([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year);
}

function minNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

// ISO 8601 timestamps sort lexicographically — no need to re-parse Dates.
function minIso(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

function maxIso(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/** After sorting, lift every child row out of its current position and
 *  reinsert it immediately after its parent. Children are grouped under
 *  their parent in code-collation order so the sequence stays stable
 *  regardless of the chosen top-level sort. Orphaned children (parent
 *  filtered out) keep their sorted position — they behave as standalone
 *  rows from the visitor's POV. */
function interleaveChildren(
  items: LocationListItem[],
): LocationListItem[] {
  const collator = new Intl.Collator("cs", { sensitivity: "base" });
  const childrenByParent = new Map<number, LocationListItem[]>();
  const ids = new Set(items.map((it) => it.id));

  for (const it of items) {
    if (it.parentId === null) continue;
    if (!ids.has(it.parentId)) continue; // keep orphans in place
    const list = childrenByParent.get(it.parentId);
    if (list) list.push(it);
    else childrenByParent.set(it.parentId, [it]);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => collator.compare(a.code, b.code));
  }

  // Rebuild the array in two passes:
  // 1. Walk the original sorted order and emit each row that is either a
  //    parent (has at least one visible child) or "free-standing"
  //    (parentId null OR parent filtered out).
  // 2. After emitting a parent, splice its children right after it.
  // Orphaned children are emitted at their original sorted position — they
  // never get attached to anyone.
  const out: LocationListItem[] = [];
  const placed = new Set<number>();
  for (const it of items) {
    if (it.parentId !== null && ids.has(it.parentId)) {
      // child of a visible parent — skip; we'll splice it after its parent
      continue;
    }
    out.push(it);
    placed.add(it.id);
    const kids = childrenByParent.get(it.id);
    if (kids) {
      for (const k of kids) {
        out.push(k);
        placed.add(k.id);
      }
    }
  }
  // Safety net: if for any reason something didn't get placed (e.g. a
  // future bug introduces multi-level hierarchy that the helper wasn't
  // designed for), append it so the row count never silently shrinks.
  if (out.length !== items.length) {
    for (const it of items) {
      if (!placed.has(it.id)) out.push(it);
    }
  }
  return out;
}
