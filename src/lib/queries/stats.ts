/**
 * Aggregated collection statistics. All queries use SQL aggregates for
 * performance — at 17k rows we don't need materialized views yet, but the
 * shape is prepared for them (docs/data-schema.md).
 *
 * The page calls one fetcher per visible section instead of a single
 * mega-query, which lets `<Suspense>` boundaries on /statistiky stream
 * each card in as it finishes rather than blocking the whole render on
 * the slowest query. Common upstream rows (totals, geo locations) are
 * memoised through React's `cache()` so two parallel fetchers in the
 * same request still hit Postgres exactly once.
 *
 * Anonymization note: these queries return *counts only*, no per-find
 * data or notes leave the server. Location names in `topLocations` are
 * public (shown on the map) so it's fine to list them.
 */

import { cache } from "react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEFAULT_LOCATION_ID } from "@/lib/constants";
import { countryFromCoords } from "@/lib/geo";
import { isFormerLocation } from "@/lib/locationCode";

/** Hard ceiling for jubilee ID generation. The collection currently sits
 *  near 17 000; one million covers ~30 years of growth at 30 k/year and
 *  keeps the candidate list under ~1010 IDs (cheap WHERE id IN(...)
 *  against a primary key). The Set + sort below dedupes the overlap
 *  between rules — e.g. 1000 hits both "multiple of 1000" and nothing
 *  else, so it appears once. */
const JUBILEE_MAX_ID = 1_000_000;

const JUBILEE_CANDIDATE_IDS: ReadonlyArray<number> = (() => {
  const set = new Set<number>();
  // Repunits ≥ 111 (the user excluded #1 and #11 — first find has its
  // own dedicated card on the page, and 11 isn't a milestone they care
  // about). Generated as 111, 1111, 11111, … via *10 + 1.
  for (let r = 111; r <= JUBILEE_MAX_ID; r = r * 10 + 1) set.add(r);
  // Two specific six-numbers — the rule isn't "all sixes", just these.
  if (666 <= JUBILEE_MAX_ID) set.add(666);
  if (6666 <= JUBILEE_MAX_ID) set.add(6666);
  // Every 1000th find.
  for (let m = 1000; m <= JUBILEE_MAX_ID; m += 1000) set.add(m);
  return Array.from(set).sort((a, b) => a - b);
})();

export interface StatsTotals {
  finds: number;
  locations: number;
  photographed: number;
  anonymized: number;
  /** Distinct finds tagged with the DONATED state — i.e. clovers that
   *  the user gifted away. Reused on the page header to highlight the
   *  share of the collection that left the archive. */
  donatedFinds: number;
  /** Distinct finds tagged with the LOST state. */
  lostFinds: number;
  /** Distinct finds tagged with the NO_PHOTO state. */
  noPhotoFinds: number;
  /** Locations where at least one location_map is flagged anonymized.
   *  Mirrors the same "any anonymized map → whole location is private"
   *  rule used in `listLocations`, so the number on /statistiky lines
   *  up with the count of hidden rows on /lokality. */
  anonymizedLocations: number;
  /** Locations whose code starts with `NEEXISTUJE-` — places that no
   *  longer exist physically (built over, ploughed under, etc.). */
  goneLocations: number;
  firstYear: number | null;
  lastYear: number | null;
}

export interface MonthlyPoint {
  month: string; // "YYYY-MM"
  count: number;
}

export interface YearlyPoint {
  year: number;
  count: number;
}

export interface LocationPoint {
  id: number;
  /** Raw code for display in the top-locations table. */
  code: string;
  /** Description / display name fallback. */
  name: string;
  count: number;
}

/** A leaderboard row for the "TOP by density" view on /statistiky. Same
 *  identifier rules as `LocationPoint`, plus the polygon area, the
 *  density figure expressed as clovers per 100 m² (so the typical
 *  number is 1–100ish), and an isAnonymized flag — anonymized rows
 *  drop their code/name on the server so the client can render a
 *  "Anonymizovaná lokalita" placeholder without re-redacting. */
export interface LocationDensityPoint {
  id: number;
  code: string | null;
  name: string | null;
  count: number;
  areaM2: number;
  densityPer100m2: number;
  isAnonymized: boolean;
}

/** Calendar-axis aggregations independent of the year. */
export interface CalendarPoint {
  /** 0–23 for hour, 1–7 (mon–sun) for dow, 1–12 for month. */
  key: number;
  count: number;
}

/** One cell of the month×day heatmap (also year-independent). */
export interface MonthDayPoint {
  /** 1–12. */
  month: number;
  /** 1–31. */
  day: number;
  count: number;
}

/** One bar of the "finds by distance from the default map" histogram. */
export interface DistanceBucket {
  /** Bucket index 0..7. Decade-based:
   *  0 = <10 m, 1 = 10–100 m, 2 = 100 m – 1 km, 3 = 1–10 km,
   *  4 = 10–100 km, 5 = 100–1 000 km, 6 = 1 000–10 000 km, 7 = >10 000 km.
   *  See DISTANCE_BUCKETS in src/app/statistiky/page.tsx for labels. */
  bucket: number;
  count: number;
}

export interface CategoryPoint {
  name: string;
  count: number;
}

/** A `CategoryPoint` extended with the ISO 3166 country code so the UI
 *  can render flags or stable React keys without re-deriving them. */
export interface CountryPoint extends CategoryPoint {
  code: string;
}

export interface FindHighlight {
  id: number;
  /** Find date as ISO string for cheap client serialization. */
  foundAt: string | null;
  isAnonymized: boolean;
  /** Location data is null when the find is anonymized — see CLAUDE.md
   *  §6, the public payload must not leak the location. */
  location: { id: number; code: string; displayName: string } | null;
}

/** A `FindHighlight` extended with great-circle distance — used for the
 *  "farthest find" card on /statistiky. */
export interface FarthestFindHighlight extends FindHighlight {
  /** Distance in metres from the default LocationMap's GPS centre. */
  distanceMeters: number;
}

export interface PeakBucket {
  /** ISO timestamp at the start of the bucket. The UI formats it
   *  per-granularity ("červen 2021" for month, "14:00–14:59" for hour). */
  startsAt: string;
  /** Number of finds whose `found_at` falls inside the bucket. */
  count: number;
}

/** Find at a "milestone" position in the sequence — every 1000th find,
 *  three repunits (111, 1111, 11111) and the two devil-numbers
 *  (666, 6666). Renders as a clickable list on /statistiky.
 *
 *  Anonymized milestones still appear in the list (the ID itself isn't
 *  private), but their `foundAt` and `location` are stripped per
 *  CLAUDE.md §6 — only the headline ID + a privacy badge surface. */
export interface JubileeFind {
  id: number;
  foundAt: string | null;
  isAnonymized: boolean;
  location: { code: string; displayName: string } | null;
}

// ---------------------------------------------------------------------------
// Per-section result shapes. The /statistiky page used to fetch one
// monolithic blob and block the entire render on the slowest query;
// each section now has its own fetcher so the page can wrap each one
// in `<Suspense>` and stream them in as they finish.

export interface StatsTotalsResult {
  totals: StatsTotals;
  /** Total distinct countries that host any non-anonymized location
   *  with GPS (regardless of finds). Sourced from the same geo rows
   *  as `byCountry`, so both fetchers share the cached query. */
  countryCount: number;
  /** Total distinct cities that host any non-anonymized, non-former
   *  location (regardless of finds). */
  cityCount: number;
}

export interface StatsHighlightsResult {
  /** Earliest find by ID. */
  firstFind: FindHighlight | null;
  /** Latest find by ID. */
  lastFind: FindHighlight | null;
  /** Non-anonymized find with the largest great-circle distance from
   *  the default LocationMap's centre. Null when MAP 00001 isn't on
   *  disk or no qualifying find exists. */
  farthestFind: FarthestFindHighlight | null;
}

export interface StatsPeaksResult {
  minute: PeakBucket | null;
  hour: PeakBucket | null;
  day: PeakBucket | null;
  week: PeakBucket | null;
  month: PeakBucket | null;
  year: PeakBucket | null;
}

export interface StatsJubileesResult {
  jubilees: JubileeFind[];
}

export interface StatsTopLocationsResult {
  topLocations: LocationPoint[];
  topLocationsByDensity: LocationDensityPoint[];
}

export interface StatsGeoResult {
  byCountry: CountryPoint[];
  byCity: CategoryPoint[];
}

export interface StatsCalendarResult {
  byHour: CalendarPoint[];
  byDayOfWeek: CalendarPoint[];
  byMonthOfYear: CalendarPoint[];
  yearly: YearlyPoint[];
  /** Sparse month×day heatmap. */
  byMonthDay: MonthDayPoint[];
  /** First year with at least one find — drives the year axis on the
   *  yearly chart so empty leading years render as zero columns. */
  firstYear: number | null;
}

export interface StatsDistanceResult {
  byDistance: DistanceBucket[];
}

// ---------------------------------------------------------------------------
// Shared raw-row types — declared once so the cached helpers and the
// individual fetchers share the same Prisma typing for `$queryRaw`.

type HighlightRow = {
  id: number;
  found_at: Date | null;
  is_anonymized: boolean;
  location_id: number | null;
  location_code: string | null;
  location_display_name: string | null;
};

type FarthestRow = HighlightRow & { dist_m: number | null };

type TotalsRow = {
  finds: bigint;
  locations: bigint;
  photographed: bigint;
  anonymized: bigint;
  donated_finds: bigint;
  lost_finds: bigint;
  no_photo_finds: bigint;
  anonymized_locations: bigint;
  gone_locations: bigint;
  first_year: number | null;
  last_year: number | null;
};

type GeoLocRow = {
  id: number;
  code: string;
  cadastral: string;
  lat: number | null;
  lng: number | null;
  count: bigint;
};

// ---------------------------------------------------------------------------
// Cached helpers — called by more than one fetcher (e.g. totals + geo
// both need country/city tallies; totals + calendar both need first
// year). React's `cache()` memoises the return value across the
// current request, so the underlying SQL still runs exactly once even
// when multiple sections render in parallel.

const fetchTotalsRow = cache(async (): Promise<TotalsRow | undefined> => {
  const rows = await prisma.$queryRaw<TotalsRow[]>`
    SELECT
      (SELECT COUNT(*) FROM finds) AS finds,
      (SELECT COUNT(*) FROM locations) AS locations,
      (SELECT COUNT(DISTINCT find_id) FROM find_images) AS photographed,
      (SELECT COUNT(*) FROM finds WHERE is_anonymized = true) AS anonymized,
      (SELECT COUNT(DISTINCT find_id) FROM find_state_assignments
         WHERE state = 'DONATED') AS donated_finds,
      (SELECT COUNT(DISTINCT find_id) FROM find_state_assignments
         WHERE state = 'LOST') AS lost_finds,
      (SELECT COUNT(DISTINCT find_id) FROM find_state_assignments
         WHERE state = 'NO_PHOTO') AS no_photo_finds,
      (SELECT COUNT(DISTINCT location_id) FROM location_maps
         WHERE is_anonymized = true) AS anonymized_locations,
      (SELECT COUNT(*) FROM locations
         WHERE code LIKE 'NEEXISTUJE-%') AS gone_locations,
      (SELECT EXTRACT(YEAR FROM MIN(found_at))::int FROM finds) AS first_year,
      (SELECT EXTRACT(YEAR FROM MAX(found_at))::int FROM finds) AS last_year
  `;
  return rows[0];
});

const fetchGeoLocRows = cache(async (): Promise<GeoLocRow[]> => {
  // Per-location aggregates with GPS — feeds the country/city tables
  // and the world bubble map, plus the cityCount/countryCount fields
  // on the totals card. Anonymized locations are filtered out (their
  // precise coordinates are private per CLAUDE.md §6).
  return prisma.$queryRaw<GeoLocRow[]>`
    SELECT
      l.id,
      l.code,
      l.cadastral_area AS cadastral,
      CASE WHEN l.center_point IS NOT NULL
           THEN ST_Y(l.center_point)::float8
      END AS lat,
      CASE WHEN l.center_point IS NOT NULL
           THEN ST_X(l.center_point)::float8
      END AS lng,
      COUNT(f.id) AS count
    FROM locations l
    LEFT JOIN finds f ON f.location_id = l.id
    WHERE l.id NOT IN (
      SELECT DISTINCT location_id FROM location_maps WHERE is_anonymized = true
    )
    GROUP BY l.id, l.code, l.cadastral_area, l.center_point
  `;
});

// ---------------------------------------------------------------------------
// Per-section public fetchers — each one wraps the queries it needs in
// its own `Promise.all`. Run them from the page in parallel inside
// separate `<Suspense>` boundaries to stream sections as they finish.

export async function getStatsTotals(): Promise<StatsTotalsResult> {
  const [totalsRow, geoRows] = await Promise.all([
    fetchTotalsRow(),
    fetchGeoLocRows(),
  ]);
  const t = totalsRow;
  const totals: StatsTotals = {
    finds: t ? Number(t.finds) : 0,
    locations: t ? Number(t.locations) : 0,
    photographed: t ? Number(t.photographed) : 0,
    anonymized: t ? Number(t.anonymized) : 0,
    donatedFinds: t ? Number(t.donated_finds) : 0,
    lostFinds: t ? Number(t.lost_finds) : 0,
    noPhotoFinds: t ? Number(t.no_photo_finds) : 0,
    anonymizedLocations: t ? Number(t.anonymized_locations) : 0,
    goneLocations: t ? Number(t.gone_locations) : 0,
    firstYear: t?.first_year ?? null,
    lastYear: t?.last_year ?? null,
  };
  const { countryCount, cityCount } = buildGeoBreakdowns(geoRows);
  return { totals, countryCount, cityCount };
}

export async function getStatsHighlights(): Promise<StatsHighlightsResult> {
  const [firstFindRow, lastFindRow, farthestFindRow] = await Promise.all([
    // Earliest find by ID. The CASE-anonymise pattern keeps location
    // info out of the payload for is_anonymized=true rows.
    prisma.$queryRaw<HighlightRow[]>`
      SELECT f.id, f.found_at, f.is_anonymized, f.location_id,
             CASE WHEN f.is_anonymized THEN NULL ELSE l.code END AS location_code,
             CASE WHEN f.is_anonymized THEN NULL
                  ELSE COALESCE(NULLIF(l.display_name, ''), l.code)
             END AS location_display_name
      FROM finds f
      LEFT JOIN locations l ON l.id = f.location_id
      ORDER BY f.id ASC
      LIMIT 1
    `,
    prisma.$queryRaw<HighlightRow[]>`
      SELECT f.id, f.found_at, f.is_anonymized, f.location_id,
             CASE WHEN f.is_anonymized THEN NULL ELSE l.code END AS location_code,
             CASE WHEN f.is_anonymized THEN NULL
                  ELSE COALESCE(NULLIF(l.display_name, ''), l.code)
             END AS location_display_name
      FROM finds f
      LEFT JOIN locations l ON l.id = f.location_id
      ORDER BY f.id DESC
      LIMIT 1
    `,
    // Farthest non-anonymized find from the default LocationMap's GPS
    // centre. The CTE makes the reference point optional: if MAP 00001
    // isn't on disk we still return zero rows instead of crashing.
    prisma.$queryRaw<FarthestRow[]>`
      WITH ref AS (
        SELECT ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326) AS pt
        FROM location_maps
        WHERE id = ${DEFAULT_LOCATION_ID}
      )
      SELECT f.id, f.found_at, f.is_anonymized, f.location_id,
             CASE WHEN f.is_anonymized THEN NULL ELSE l.code END AS location_code,
             CASE WHEN f.is_anonymized THEN NULL
                  ELSE COALESCE(NULLIF(l.display_name, ''), l.code)
             END AS location_display_name,
             ST_DistanceSphere(f.coordinates, (SELECT pt FROM ref))::float8 AS dist_m
      FROM finds f
      LEFT JOIN locations l ON l.id = f.location_id
      WHERE f.is_anonymized = false
        AND f.coordinates IS NOT NULL
        AND (SELECT pt FROM ref) IS NOT NULL
      ORDER BY dist_m DESC NULLS LAST
      LIMIT 1
    `,
  ]);

  const farthestRow = farthestFindRow[0];
  const farthestBase =
    farthestRow && farthestRow.dist_m !== null ? toHighlight(farthestRow) : null;
  const farthestFind: FarthestFindHighlight | null =
    farthestBase && farthestRow && farthestRow.dist_m !== null
      ? { ...farthestBase, distanceMeters: Number(farthestRow.dist_m) }
      : null;

  return {
    firstFind: toHighlight(firstFindRow[0]),
    lastFind: toHighlight(lastFindRow[0]),
    farthestFind,
  };
}

export async function getStatsPeaks(): Promise<StatsPeaksResult> {
  // Peak buckets — busiest minute / hour / day / week / month / year.
  // Each query truncates `found_at` to its granularity, groups, and
  // picks the row with the highest count (ties broken by earliest
  // bucket so the chosen result is deterministic across runs).
  const [
    peakMinuteRow,
    peakHourRow,
    peakDayRow,
    peakWeekRow,
    peakMonthRow,
    peakYearRow,
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
      SELECT date_trunc('minute', found_at) AS bucket, COUNT(*) AS count
      FROM finds WHERE found_at IS NOT NULL
      GROUP BY 1 ORDER BY count DESC, bucket ASC LIMIT 1
    `,
    prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
      SELECT date_trunc('hour', found_at) AS bucket, COUNT(*) AS count
      FROM finds WHERE found_at IS NOT NULL
      GROUP BY 1 ORDER BY count DESC, bucket ASC LIMIT 1
    `,
    prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
      SELECT date_trunc('day', found_at) AS bucket, COUNT(*) AS count
      FROM finds WHERE found_at IS NOT NULL
      GROUP BY 1 ORDER BY count DESC, bucket ASC LIMIT 1
    `,
    prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
      SELECT date_trunc('week', found_at) AS bucket, COUNT(*) AS count
      FROM finds WHERE found_at IS NOT NULL
      GROUP BY 1 ORDER BY count DESC, bucket ASC LIMIT 1
    `,
    prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
      SELECT date_trunc('month', found_at) AS bucket, COUNT(*) AS count
      FROM finds WHERE found_at IS NOT NULL
      GROUP BY 1 ORDER BY count DESC, bucket ASC LIMIT 1
    `,
    prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
      SELECT date_trunc('year', found_at) AS bucket, COUNT(*) AS count
      FROM finds WHERE found_at IS NOT NULL
      GROUP BY 1 ORDER BY count DESC, bucket ASC LIMIT 1
    `,
  ]);

  return {
    minute: toPeakBucket(peakMinuteRow),
    hour: toPeakBucket(peakHourRow),
    day: toPeakBucket(peakDayRow),
    week: toPeakBucket(peakWeekRow),
    month: toPeakBucket(peakMonthRow),
    year: toPeakBucket(peakYearRow),
  };
}

export async function getStatsJubilees(): Promise<StatsJubileesResult> {
  // Jubilee finds — every 1000th, three repunits (111, 1111, 11111),
  // and the two devil-numbers (666, 6666). The `WHERE id IN (...)`
  // filter against a primary key returns only existing rows, so any
  // missing ID is silently skipped (the user fills gaps later as the
  // collection grows).
  const rows = await prisma.$queryRaw<
    Array<{
      id: number;
      found_at: Date | null;
      is_anonymized: boolean;
      location_id: number | null;
      location_code: string | null;
      location_display_name: string | null;
    }>
  >`
    SELECT f.id, f.found_at, f.is_anonymized, f.location_id,
           CASE WHEN f.is_anonymized THEN NULL ELSE l.code END AS location_code,
           CASE WHEN f.is_anonymized THEN NULL
                ELSE COALESCE(NULLIF(l.display_name, ''), l.code)
           END AS location_display_name
    FROM finds f
    LEFT JOIN locations l ON l.id = f.location_id
    WHERE f.id IN (${Prisma.join(JUBILEE_CANDIDATE_IDS)})
    ORDER BY f.id ASC
  `;
  return {
    jubilees: rows.map((r) => ({
      id: r.id,
      foundAt: r.found_at ? r.found_at.toISOString() : null,
      isAnonymized: r.is_anonymized,
      // location is always null for anonymized rows — the SQL CASE
      // clause already redacts code/displayName, so this just normalises
      // the shape downstream.
      location:
        !r.is_anonymized && r.location_id !== null && r.location_code
          ? {
              code: r.location_code,
              displayName: r.location_display_name ?? r.location_code,
            }
          : null,
    })),
  };
}

export async function getStatsTopLocations(): Promise<StatsTopLocationsResult> {
  const [topLocRows, topDensityRows] = await Promise.all([
    // Top 10 locations by find count.
    // - Anonymized locations are dropped (their code/name/findCount can't
    //   be exposed publicly per CLAUDE.md §6).
    // - Sub-parts (parent_id IS NOT NULL) are folded into their parent so
    //   a master location's row shows the combined "true" total.
    prisma.$queryRaw<
      Array<{ id: number; code: string; name: string; count: bigint }>
    >`
      WITH anon AS (
        SELECT DISTINCT location_id FROM location_maps WHERE is_anonymized = true
      ),
      bucket AS (
        SELECT f.id AS find_id,
               CASE
                 WHEN l.parent_id IS NOT NULL
                      AND l.parent_id NOT IN (SELECT location_id FROM anon)
                 THEN l.parent_id
                 ELSE f.location_id
               END AS bucket_id
        FROM finds f
        LEFT JOIN locations l ON l.id = f.location_id
      )
      SELECT l.id,
             l.code,
             COALESCE(NULLIF(l.display_name, ''), l.code) AS name,
             COUNT(b.find_id) AS count
      FROM locations l
      LEFT JOIN bucket b ON b.bucket_id = l.id
      WHERE l.id NOT IN (SELECT location_id FROM anon)
        AND NOT (
          l.parent_id IS NOT NULL
          AND l.parent_id NOT IN (SELECT location_id FROM anon)
        )
      GROUP BY l.id, l.code, l.display_name
      ORDER BY count DESC, l.id
      LIMIT 10
    `,
    // Top 10 locations by find density (own finds per 100 m² of own
    // polygon). Only locations with a polygon and ≥ 10 own finds.
    // Anonymized rows are kept (their density tells a story too) but
    // their code/name is nulled here so the public payload never
    // carries identifying text. The polygon column lives on
    // `locations`, not on `location_maps` — see prisma/schema.prisma.
    prisma.$queryRaw<
      Array<{
        id: number;
        code: string | null;
        name: string | null;
        count: bigint;
        area_m2: number;
        density: number;
        is_anonymized: boolean;
      }>
    >`
      WITH anon AS (
        SELECT DISTINCT location_id FROM location_maps WHERE is_anonymized = true
      ),
      counts AS (
        SELECT location_id, COUNT(*) AS cnt
        FROM finds
        WHERE location_id IS NOT NULL
        GROUP BY location_id
      ),
      areas AS (
        SELECT id, ST_Area(polygon::geography)::float8 AS area_m2
        FROM locations
        WHERE polygon IS NOT NULL
      )
      SELECT l.id,
             CASE WHEN l.id IN (SELECT location_id FROM anon)
                  THEN NULL ELSE l.code END AS code,
             CASE WHEN l.id IN (SELECT location_id FROM anon)
                  THEN NULL ELSE COALESCE(NULLIF(l.display_name, ''), l.code)
             END AS name,
             c.cnt AS count,
             a.area_m2 AS area_m2,
             (c.cnt::float8 / a.area_m2 * 100) AS density,
             (l.id IN (SELECT location_id FROM anon)) AS is_anonymized
      FROM locations l
      JOIN areas a ON a.id = l.id
      JOIN counts c ON c.location_id = l.id
      WHERE c.cnt >= 10
        AND a.area_m2 > 0
      ORDER BY density DESC, l.id
      LIMIT 10
    `,
  ]);
  return {
    topLocations: topLocRows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      count: Number(r.count),
    })),
    topLocationsByDensity: topDensityRows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      count: Number(r.count),
      areaM2: Number(r.area_m2),
      densityPer100m2: Number(r.density),
      isAnonymized: r.is_anonymized,
    })),
  };
}

export async function getStatsGeo(): Promise<StatsGeoResult> {
  const rows = await fetchGeoLocRows();
  const { byCountry, byCity } = buildGeoBreakdowns(rows);
  return { byCountry, byCity };
}

export async function getStatsCalendar(): Promise<StatsCalendarResult> {
  // Calendar axes — ignore time zone offsets (use the find's local
  // wall-clock the user recorded). Anonymization-stripped foundAt is
  // fine because `is_anonymized` doesn't affect the timestamp.
  const [yearlyRows, hourRows, dowRows, monthRows, monthDayRows, totalsRow] =
    await Promise.all([
      prisma.$queryRaw<Array<{ year: number; count: bigint }>>`
        SELECT EXTRACT(YEAR FROM found_at)::int AS year, COUNT(*) AS count
        FROM finds WHERE found_at IS NOT NULL
        GROUP BY 1 ORDER BY 1
      `,
      prisma.$queryRaw<Array<{ hour: number; count: bigint }>>`
        SELECT EXTRACT(HOUR FROM found_at)::int AS hour, COUNT(*) AS count
        FROM finds WHERE found_at IS NOT NULL
        GROUP BY 1 ORDER BY 1
      `,
      // Postgres DOW: 0=Sunday … 6=Saturday. Convert to ISO 1=Mon … 7=Sun
      // so the result is naturally ordered for a Czech week.
      prisma.$queryRaw<Array<{ dow: number; count: bigint }>>`
        SELECT EXTRACT(ISODOW FROM found_at)::int AS dow, COUNT(*) AS count
        FROM finds WHERE found_at IS NOT NULL
        GROUP BY 1 ORDER BY 1
      `,
      prisma.$queryRaw<Array<{ month: number; count: bigint }>>`
        SELECT EXTRACT(MONTH FROM found_at)::int AS month, COUNT(*) AS count
        FROM finds WHERE found_at IS NOT NULL
        GROUP BY 1 ORDER BY 1
      `,
      // Year-independent month×day heatmap. Returns sparse — only cells
      // that have any finds; the page fills the rest with zeros.
      prisma.$queryRaw<Array<{ month: number; day: number; count: bigint }>>`
        SELECT EXTRACT(MONTH FROM found_at)::int AS month,
               EXTRACT(DAY FROM found_at)::int AS day,
               COUNT(*) AS count
        FROM finds WHERE found_at IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 1, 2
      `,
      fetchTotalsRow(),
    ]);
  return {
    byHour: hourRows.map((r) => ({ key: r.hour, count: Number(r.count) })),
    byDayOfWeek: dowRows.map((r) => ({ key: r.dow, count: Number(r.count) })),
    byMonthOfYear: monthRows.map((r) => ({
      key: r.month,
      count: Number(r.count),
    })),
    yearly: yearlyRows.map((r) => ({
      year: r.year,
      count: Number(r.count),
    })),
    byMonthDay: monthDayRows.map((r) => ({
      month: r.month,
      day: r.day,
      count: Number(r.count),
    })),
    firstYear: totalsRow?.first_year ?? null,
  };
}

export async function getStatsDistance(): Promise<StatsDistanceResult> {
  // Decade-bucketed distance histogram from the default LocationMap.
  // Anonymized finds and finds without GPS are excluded — same rule as
  // the farthest-find query. Returns sparse (zero buckets are omitted);
  // the page fills them with zeros for a stable axis.
  const rows = await prisma.$queryRaw<
    Array<{ bucket: number; count: bigint }>
  >`
    WITH ref AS (
      SELECT ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326) AS pt
      FROM location_maps
      WHERE id = ${DEFAULT_LOCATION_ID}
    ),
    distances AS (
      SELECT ST_DistanceSphere(f.coordinates, (SELECT pt FROM ref)) AS dist_m
      FROM finds f
      WHERE f.is_anonymized = false
        AND f.coordinates IS NOT NULL
        AND (SELECT pt FROM ref) IS NOT NULL
    )
    SELECT
      CASE
        WHEN dist_m < 10        THEN 0
        WHEN dist_m < 100       THEN 1
        WHEN dist_m < 1000      THEN 2
        WHEN dist_m < 10000     THEN 3
        WHEN dist_m < 100000    THEN 4
        WHEN dist_m < 1000000   THEN 5
        WHEN dist_m < 10000000  THEN 6
        ELSE                         7
      END AS bucket,
      COUNT(*) AS count
    FROM distances
    GROUP BY bucket
    ORDER BY bucket
  `;
  return {
    byDistance: rows.map((r) => ({
      bucket: r.bucket,
      count: Number(r.count),
    })),
  };
}

// ---------------------------------------------------------------------------
// Local helpers shared by multiple fetchers above.

function toHighlight(row: HighlightRow | undefined): FindHighlight | null {
  if (!row) return null;
  return {
    id: row.id,
    foundAt: row.found_at ? row.found_at.toISOString() : null,
    isAnonymized: row.is_anonymized,
    location:
      !row.is_anonymized && row.location_id !== null && row.location_code
        ? {
            id: row.location_id,
            code: row.location_code,
            displayName: row.location_display_name ?? row.location_code,
          }
        : null,
  };
}

/** Lift the single-row LIMIT 1 raw-query result to a PeakBucket, or
 *  null when the query returned nothing (collection empty / every find
 *  has NULL `found_at`). Date → ISO so the value travels through
 *  Server → Client serialization unchanged. */
function toPeakBucket(
  rows: ReadonlyArray<{ bucket: Date; count: bigint }>,
): PeakBucket | null {
  const r = rows[0];
  if (!r) return null;
  return { startsAt: r.bucket.toISOString(), count: Number(r.count) };
}

/** Splits the per-location aggregate into the three geo breakdowns the
 *  stats page needs. `getStatsTotals` reads cityCount/countryCount;
 *  `getStatsGeo` reads byCountry/byCity. Both share the cached
 *  `fetchGeoLocRows()` so the heavy LEFT JOIN runs once per request. */
function buildGeoBreakdowns(
  rows: ReadonlyArray<GeoLocRow>,
): {
  byCountry: CountryPoint[];
  byCity: CategoryPoint[];
  /** Total number of distinct cities that host at least one real
   *  (non-anonymized, non-former) location, even if its finds are
   *  still zero. Used by the corner card on /statistiky. */
  cityCount: number;
  /** Total number of distinct countries that host at least one
   *  non-anonymized location with GPS, even if no finds yet. */
  countryCount: number;
} {
  const countryAcc = new Map<string, { name: string; count: number }>();
  const cityAcc = new Map<string, number>();

  for (const r of rows) {
    const c = Number(r.count);
    // Vanished places ("NEEXISTUJE-PRAGUE_…") still get counted in the
    // country breakdown — they were physically *somewhere* — but the
    // city tally would otherwise list rows like "NEEXISTUJE-ZLÍN" next
    // to "ZLÍN", which is misleading. Drop them here.
    //
    // No c > 0 gate: a city is registered as soon as a real (non-vanished)
    // location exists there, even if it has zero finds yet. The same
    // holds for countries — geoLocRows comes from a LEFT JOIN so empty
    // locations contribute count = 0 (still bumps the dictionary entry).
    // The byCity / byCountry arrays returned to the table renderer then
    // re-filter to count > 0 so empty places don't clutter the breakdown.
    if (!isFormerLocation(r.code)) {
      const cityKey = r.cadastral || r.code;
      cityAcc.set(cityKey, (cityAcc.get(cityKey) ?? 0) + c);
    }
    if (r.lat !== null && r.lng !== null) {
      const country = countryFromCoords(r.lat, r.lng);
      const prev = countryAcc.get(country.code);
      if (prev) {
        prev.count += c;
      } else {
        countryAcc.set(country.code, { name: country.name, count: c });
      }
    }
  }

  // Card counts include zero-find cities/countries; the breakdown
  // tables only show places that already have at least one find so
  // they stay informative rather than padded with "0 nálezů" rows.
  const cityCount = cityAcc.size;
  const countryCount = countryAcc.size;

  const byCountry: CountryPoint[] = [...countryAcc.entries()]
    .filter(([, v]) => v.count > 0)
    .map(([code, v]) => ({ code, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "cs"));

  const byCity: CategoryPoint[] = [...cityAcc.entries()]
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "cs"));

  return { byCountry, byCity, cityCount, countryCount };
}
