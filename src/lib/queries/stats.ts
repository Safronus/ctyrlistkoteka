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
import {
  DEFAULT_LOCATION_ID,
  FIND_DEVIATION_RADIUS_M,
  RECORD_FIND_ID,
} from "@/lib/constants";
import { countryFromCoords } from "@/lib/geo";
import { czRegionFromCoords } from "@/lib/cz-regions";
import { cityFromCadastralArea } from "@/lib/locationCode";
import { listCadastralAreas } from "@/lib/queries/locations";

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
  // The Czech-record find — fetched here so the jubilee section can pin
  // it to its own card (it usually isn't a milestone id on its own).
  set.add(RECORD_FIND_ID);
  return Array.from(set).sort((a, b) => a - b);
})();

export interface StatsTotals {
  finds: number;
  /** Highest find ID currently in the table. Mirrors the home tile's
   *  `maxFindId` — the canonical "size of the numbered series" figure
   *  the operator sorts by. Differs from `finds` only when there's a
   *  backfill gap (a few late uploads still pending), in which case
   *  the UI surfaces both numbers side-by-side. */
  maxFindId: number | null;
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
  /** Distinct finds tagged with the GIGANT state — abnormally large
   *  clovers (kosmetický cosmetic state, see schema.prisma:29). The
   *  first totals tile surfaces this as a small badge so the operator
   *  has a single glance count of "specials". */
  gigantFinds: number;
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

/** One sparse cell of the minute heatmap (day-of-year × minute-of-day).
 *  Cells with zero finds are omitted; the page fills them on render.
 *  Aggregated across all years to surface seasonal + time-of-day
 *  patterns regardless of which year the find landed in. */
export interface MinuteHeatmapCell {
  /** 1–366 (Postgres EXTRACT(DOY)). */
  doy: number;
  /** 0–1439, computed as hour*60 + minute. */
  mod: number;
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
 *  can render flags or stable React keys without re-deriving them.
 *
 *  `name` carries the raw English country name from the Natural Earth
 *  dataset (e.g. "Czechia", "Japan", or the "Elsewhere" sentinel) —
 *  the UI is expected to localize it via `localizedCountryName` so
 *  the cached aggregate stays locale-agnostic. */
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
  /** Whether the find row carries GPS coordinates. Drives the map
   *  deep-link button on /statistiky cards — without GPS the
   *  /mapa?find=N page can't resolve a highlight, so the button
   *  is hidden. Always true for FarthestFindHighlight (its query
   *  filter requires coordinates). */
  hasGps: boolean;
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

/** Sliding-window peak — the busiest stretch of N consecutive
 *  minutes / hours / days across the timeline, anchored to whatever
 *  find timestamp produced the highest count. Distinct from
 *  PeakBucket: calendar buckets snap to "14:00–14:59 on a given
 *  day", whereas a sliding window can start at 13:45 if that 60-
 *  minute stretch is denser than any whole-hour bucket. */
export interface PeakSlidingWindow {
  /** ISO timestamp of the earliest find inside the winning window. */
  startsAt: string;
  /** ISO timestamp of the latest find inside the winning window.
   *  May equal startsAt when the window contains a single find,
   *  which would be odd here but keeps the shape regular. */
  endsAt: string;
  /** Number of finds inside the window. */
  count: number;
}

/** Fastest stretch of N consecutive finds — the smallest gap between a
 *  find and the one N-1 positions later in chronological (found_at)
 *  order. "Consecutive" = adjacent in time, not at any milestone. The
 *  duration is `found_at[i+N-1] − found_at[i]`, minimised over i. */
export interface PeakFastestWindow {
  /** Window size — 10 / 100 / 1000. */
  size: number;
  /** Duration of the fastest such stretch, in seconds. */
  seconds: number;
  /** First find of the winning stretch. */
  startId: number;
  startsAt: string;
  /** Last find of the winning stretch. */
  endId: number;
  endsAt: string;
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
  /** True when the find carries the DONATED state assignment in
   *  data/meta/LokaceStavyPoznamky.json (and so its find_state_
   *  assignments row exists in DB). Rendered as a small badge in
   *  the top-right corner of the jubilee tile so the user can tell
   *  at a glance which milestones have already been gifted. Honour
   *  the anonymization flag — anonymized finds don't expose the
   *  state, matching the privacy stance everywhere else. */
  isDonated: boolean;
  /** Same role as on FindHighlight — gates the map deep-link button. */
  hasGps: boolean;
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
  /** Total distinct cities across ALL locations (incl. anonymized
   *  ones and former `NEEXISTUJE-` rows, which collapse onto the
   *  canonical city bucket). Matches the count of options the
   *  operator sees in the "Město" dropdown on /sbirka and /lokality —
   *  that's the same source. */
  cityCount: number;
}

/** Same 5 pace metrics as the all-time card, scoped to a single
 *  calendar year. The window is `[max(year-jan-01, firstFoundAt),
 *  min(now, year-dec-31+1d)]` so the first year (collecting started
 *  mid-year) and the current year (not finished) are both pro-rated
 *  against actual elapsed time, not a full 365 days. */
export interface YearlyPaceEntry {
  year: number;
  /** Number of finds with `found_at` in this calendar year. */
  totalFinds: number;
  perHour: number;
  perDay: number;
  perWeek: number;
  perMonth: number;
  perYear: number;
  /** Estimated picking time in this year, in whole minutes. Sessions
   *  are attributed to the year their start timestamp falls in. */
  estimatedMinutes: number;
  /** Sessions ("hledání") that started in this year. */
  sessions: number;
  /** Distinct locations visited in this year (≥ 1 dated find with
   *  a location). */
  locationCount: number;
  /** Average finds per session in this year — folded server-side so
   *  the client doesn't divide-by-zero on empty years. */
  findsPerSession: number;
}

export interface StatsTimeAndPaceResult {
  /** Estimated total picking time across the whole collection in
   *  whole minutes. Uses the same session math as the home tile —
   *  per-location runs broken on > 15 min gaps + 2 min baseline per
   *  session — so the home "Nejlepší den" rate and this aggregate
   *  speak the same language. */
  estimatedMinutes: number;
  /** Total sessions counted. Surfaced for the README math + so the
   *  caption under the headline can name how many sessions the
   *  number folds in. */
  sessions: number;
  /** ISO timestamp of the earliest find (the calendar anchor for the
   *  pace numbers). Null when the collection is empty. */
  firstFoundAt: string | null;
  /** Total finds carrying a found_at timestamp — the numerator of
   *  the calendar pace. Finds without dates are excluded; they have
   *  no calendar position to attribute. */
  totalFindsWithDate: number;
  /** count / elapsed_unit, where elapsed = now − firstFoundAt. Hours
   *  use 3600 s, days 86 400 s, weeks 7 days, months 30.44 days
   *  (Julian average), years 365.25 days. Rendered as 1-decimal
   *  Czech locale on the page. */
  perHour: number;
  perDay: number;
  perWeek: number;
  perMonth: number;
  perYear: number;
  /** Distinct locations that contributed at least one dated find with
   *  a location_id (i.e. counted in the session math). Surfaced
   *  alongside the all-time session count so the caption can read
   *  "X hledání na Y lokalitách". */
  locationCount: number;
  /** Average finds per session across the whole collection — folded
   *  server-side so the client doesn't divide-by-zero on empty
   *  collections. */
  findsPerSession: number;
  /** First / last calendar year with at least one dated find. Null
   *  when the collection is empty. */
  firstYear: number | null;
  lastYear: number | null;
  /** Per-year pace stats for every year between firstYear..lastYear,
   *  inclusive. Years with no finds appear with zeros so the year
   *  selector can render every position even mid-collection-gaps. */
  perYearStats: YearlyPaceEntry[];
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
  /** Sliding 60-minute window with the highest find count. */
  slidingHour: PeakSlidingWindow | null;
  /** Sliding 24-hour window with the highest find count. */
  slidingDay: PeakSlidingWindow | null;
  /** Sliding 7-day window with the highest find count. */
  slidingWeek: PeakSlidingWindow | null;
  /** Shortest time span over 10 / 100 / 1000 consecutive finds. */
  fastest10: PeakFastestWindow | null;
  fastest100: PeakFastestWindow | null;
  fastest1000: PeakFastestWindow | null;
}

export interface StatsJubileesResult {
  jubilees: JubileeFind[];
}

export interface StatsTopLocationsResult {
  topLocations: LocationPoint[];
  topLocationsByDensity: LocationDensityPoint[];
  /** Mean finds per location across every location = located finds /
   *  location count. Shown beside the "by count" toggle as a baseline. */
  avgFindsPerLocation: number;
  /** Mean of every location's own density (clovers / 100 m²) over the
   *  locations that have at least one find. Polygon-less locations are
   *  included with a 5 m-radius circle as their area. Shown beside the
   *  "by density" toggle. */
  avgDensityPer100m2: number;
}

export interface StatsGeoResult {
  byCountry: CountryPoint[];
  byCity: CategoryPoint[];
  /** Finds per Czech region (kraj), for the "podle krajů ČR" map mode.
   *  `code` is the ISO 3166-2 region code (e.g. "CZ-ZL"); `name` is the
   *  Czech region name. Only points resolving inside ČR contribute. */
  byKraj: CountryPoint[];
}

export interface StatsCalendarResult {
  byHour: CalendarPoint[];
  byDayOfWeek: CalendarPoint[];
  byMonthOfYear: CalendarPoint[];
  yearly: YearlyPoint[];
  /** Sparse month×day heatmap. */
  byMonthDay: MonthDayPoint[];
  /** Sparse day-of-year × minute-of-day heatmap. Same shape, finer
   *  granularity — used by the "Minuty" tab in the calendar heatmap
   *  section. Client buckets these into 1/5/15/60 min bins. */
  byMinute: MinuteHeatmapCell[];
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
  has_gps: boolean;
};

type FarthestRow = HighlightRow & { dist_m: number | null };

type TotalsRow = {
  finds: bigint;
  max_find_id: number | null;
  locations: bigint;
  photographed: bigint;
  anonymized: bigint;
  donated_finds: bigint;
  lost_finds: bigint;
  no_photo_finds: bigint;
  gigant_finds: bigint;
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
      (SELECT MAX(id) FROM finds)::int AS max_find_id,
      (SELECT COUNT(*) FROM locations) AS locations,
      (SELECT COUNT(DISTINCT find_id) FROM find_images) AS photographed,
      (SELECT COUNT(*) FROM finds WHERE is_anonymized = true) AS anonymized,
      (SELECT COUNT(DISTINCT find_id) FROM find_state_assignments
         WHERE state = 'DONATED') AS donated_finds,
      (SELECT COUNT(DISTINCT find_id) FROM find_state_assignments
         WHERE state = 'LOST') AS lost_finds,
      (SELECT COUNT(DISTINCT find_id) FROM find_state_assignments
         WHERE state = 'NO_PHOTO') AS no_photo_finds,
      (SELECT COUNT(DISTINCT find_id) FROM find_state_assignments
         WHERE state = 'GIGANT') AS gigant_finds,
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
  const [totalsRow, geoRows, cityList] = await Promise.all([
    fetchTotalsRow(),
    fetchGeoLocRows(),
    // Same source the /sbirka and /lokality city dropdown reads —
    // distinct cadastralAreas across ALL locations (incl. anonymized
    // ones), normalized via cityFromCadastralArea. The stats card
    // count must match what the operator sees in the filter UI;
    // buildGeoBreakdowns' city accumulator is GPS-joined and skips
    // locations whose maps are anonymized, which silently shaves
    // cities off the headline tally even though they're real.
    listCadastralAreas(),
  ]);
  const t = totalsRow;
  const totals: StatsTotals = {
    finds: t ? Number(t.finds) : 0,
    maxFindId: t?.max_find_id ?? null,
    locations: t ? Number(t.locations) : 0,
    photographed: t ? Number(t.photographed) : 0,
    anonymized: t ? Number(t.anonymized) : 0,
    donatedFinds: t ? Number(t.donated_finds) : 0,
    lostFinds: t ? Number(t.lost_finds) : 0,
    noPhotoFinds: t ? Number(t.no_photo_finds) : 0,
    gigantFinds: t ? Number(t.gigant_finds) : 0,
    anonymizedLocations: t ? Number(t.anonymized_locations) : 0,
    goneLocations: t ? Number(t.gone_locations) : 0,
    firstYear: t?.first_year ?? null,
    lastYear: t?.last_year ?? null,
  };
  // Discard buildGeoBreakdowns' cityCount in favor of cityList.length
  // (see comment above). countryCount stays GPS-derived — country is
  // public-facing aggregate territory info, and anonymized locations
  // legitimately don't contribute to it.
  const { countryCount } = buildGeoBreakdowns(geoRows);
  return { totals, countryCount, cityCount: cityList.length };
}

/** New session opens whenever two consecutive finds inside one
 *  location are this far apart (15 min). Mirrored from
 *  src/lib/queries/home.ts so the home tile and the /statistiky
 *  aggregate use one definition. */
const STATS_SESSION_GAP_MS = 15 * 60 * 1000;
/** Per-session warm-up baseline (2 min). Same constant as home page;
 *  if it ever needs tuning, change both call sites — the README
 *  documents both. */
const STATS_SESSION_BASELINE_MS = 2 * 60 * 1000;

export async function getStatsTimeAndPace(): Promise<StatsTimeAndPaceResult> {
  // Pull every find with a known location + timestamp. ~17k rows ×
  // (4 + 8) bytes is ~200 KB on the wire; the JS sort + walk runs in
  // a few ms. Cheaper than asking the DB to compute sessions via
  // window functions, and the same routine handles the per-day case
  // on the home tile.
  const rows = await prisma.$queryRaw<
    Array<{ location_id: number | null; found_at: Date }>
  >`
    SELECT location_id, found_at
    FROM finds
    WHERE found_at IS NOT NULL AND location_id IS NOT NULL
    ORDER BY location_id, found_at ASC
  `;

  // Bucket by location, then walk each run accumulating session
  // durations + counting sessions for the baseline credit at the end.
  const byLoc = new Map<number, number[]>();
  for (const r of rows) {
    const arr = byLoc.get(r.location_id as number);
    const ts = r.found_at.getTime();
    if (arr) arr.push(ts);
    else byLoc.set(r.location_id as number, [ts]);
  }

  // Walk the byLoc map and emit one session per (locationId, run) pair.
  // Each emit() folds the session into both the all-time totals and
  // the per-year aggregates (year keyed by the session's *start*
  // timestamp). Baseline time is added per-session here rather than in
  // a single trailing multiplication so that per-year totals get the
  // baseline credit for sessions starting in their own year.
  let totalMs = 0;
  let sessions = 0;
  let totalFindsInSessions = 0;
  type YearAgg = {
    ms: number;
    sessions: number;
    locs: Set<number>;
    finds: number;
  };
  const yearAgg = new Map<number, YearAgg>();
  const ensureYearAgg = (year: number): YearAgg => {
    let agg = yearAgg.get(year);
    if (!agg) {
      agg = { ms: 0, sessions: 0, locs: new Set(), finds: 0 };
      yearAgg.set(year, agg);
    }
    return agg;
  };
  const emit = (locId: number, startMs: number, endMs: number) => {
    const dur = endMs - startMs + STATS_SESSION_BASELINE_MS;
    totalMs += dur;
    sessions += 1;
    const agg = ensureYearAgg(new Date(startMs).getUTCFullYear());
    agg.ms += dur;
    agg.sessions += 1;
    agg.locs.add(locId);
  };
  for (const [locId, ts] of byLoc.entries()) {
    if (ts.length === 0) continue;
    // Count every find by its own year first — that way an
    // overnight-spanning session whose finds straddle Dec 31 still
    // attributes each individual find to the year it actually
    // happened in (sessions remain attributed by their start year).
    for (const t of ts) {
      const agg = ensureYearAgg(new Date(t).getUTCFullYear());
      agg.finds += 1;
      totalFindsInSessions += 1;
    }
    let sessionStart = ts[0]!;
    let prev = sessionStart;
    for (let i = 1; i < ts.length; i++) {
      const cur = ts[i]!;
      if (cur - prev > STATS_SESSION_GAP_MS) {
        emit(locId, sessionStart, prev);
        sessionStart = cur;
      }
      prev = cur;
    }
    emit(locId, sessionStart, prev);
  }
  const estimatedMinutes = Math.round(totalMs / 60_000);
  const findsPerSession = sessions > 0 ? totalFindsInSessions / sessions : 0;
  // Distinct locations with any dated find — `byLoc` was built from
  // exactly that filter (location_id IS NOT NULL AND found_at IS NOT
  // NULL), so its size matches what the session math actually saw.
  const locationCount = byLoc.size;

  // Calendar anchor + pace. Using all finds with a date for the
  // numerator (matching the elapsed-since-first scope), not just the
  // ones we could place in a session — finds with a date but no
  // location still count toward "stuff that happened in the calendar".
  // The yearly count piggy-backs on the same pass — Postgres groups
  // GROUP-BY-EXTRACT under a single sequential scan, so it costs only
  // marginally more than the bare COUNT(*).
  const [anchor, yearlyRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{ first_found_at: Date | null; total: bigint }>
    >`
      SELECT MIN(found_at) AS first_found_at,
             COUNT(*) FILTER (WHERE found_at IS NOT NULL) AS total
      FROM finds
    `,
    prisma.$queryRaw<Array<{ year: number; total: bigint }>>`
      SELECT EXTRACT(YEAR FROM found_at)::int AS year, COUNT(*)::bigint AS total
      FROM finds WHERE found_at IS NOT NULL
      GROUP BY 1 ORDER BY 1
    `,
  ]);
  const a = anchor[0];
  const firstFoundAt = a?.first_found_at ?? null;
  const totalFindsWithDate = a ? Number(a.total) : 0;

  if (!firstFoundAt || totalFindsWithDate === 0) {
    return {
      estimatedMinutes,
      sessions,
      firstFoundAt: null,
      totalFindsWithDate,
      perHour: 0,
      perDay: 0,
      perWeek: 0,
      perMonth: 0,
      perYear: 0,
      locationCount,
      findsPerSession,
      firstYear: null,
      lastYear: null,
      perYearStats: [],
    };
  }

  const elapsedSec = (Date.now() - firstFoundAt.getTime()) / 1000;
  const elapsedHours = elapsedSec / 3600;
  const elapsedDays = elapsedSec / 86_400;
  const elapsedWeeks = elapsedDays / 7;
  // 30.44 = average month length (365.25 / 12); 365.25 = Julian year
  // accounting for leap years. These are the conventional averages for
  // calendar-rate reporting; using calendar-month buckets would give
  // wobbly numbers depending on which month you sample at.
  const elapsedMonths = elapsedDays / 30.44;
  const elapsedYears = elapsedDays / 365.25;

  // Per-year stats: same 5 metrics as all-time, but the elapsed window
  // is clamped to `[max(year-start, firstFoundAt), min(now, year-end)]`
  // so partial years (first/last) pro-rate against actual elapsed time
  // instead of a full 365.25 days. EXTRACT(YEAR FROM ...) is what the
  // /statistiky calendar uses as well — staying consistent so the year
  // buckets here line up with the bar chart elsewhere on the page.
  const countByYear = new Map<number, number>();
  for (const r of yearlyRows) countByYear.set(r.year, Number(r.total));
  const firstYear = yearlyRows.length > 0 ? yearlyRows[0]!.year : null;
  const lastYear =
    yearlyRows.length > 0 ? yearlyRows[yearlyRows.length - 1]!.year : null;
  const nowMs = Date.now();
  const firstFoundMs = firstFoundAt.getTime();
  const perYearStats: YearlyPaceEntry[] = [];
  if (firstYear !== null && lastYear !== null) {
    for (let y = firstYear; y <= lastYear; y++) {
      const yearStartMs = Date.UTC(y, 0, 1);
      const yearEndMs = Date.UTC(y + 1, 0, 1);
      const windowStart =
        y === firstYear ? Math.max(yearStartMs, firstFoundMs) : yearStartMs;
      const windowEnd = Math.min(yearEndMs, nowMs);
      const yearElapsedSec = Math.max((windowEnd - windowStart) / 1000, 1);
      const yearElapsedHours = yearElapsedSec / 3600;
      const yearElapsedDays = yearElapsedSec / 86_400;
      const yearElapsedWeeks = yearElapsedDays / 7;
      const yearElapsedMonths = yearElapsedDays / 30.44;
      const yearElapsedYears = yearElapsedDays / 365.25;
      const total = countByYear.get(y) ?? 0;
      const agg = yearAgg.get(y);
      const yearSessions = agg?.sessions ?? 0;
      const yearFindsInSessions = agg?.finds ?? 0;
      perYearStats.push({
        year: y,
        totalFinds: total,
        perHour: total / Math.max(yearElapsedHours, 1),
        perDay: total / Math.max(yearElapsedDays, 1),
        perWeek: total / Math.max(yearElapsedWeeks, 1),
        perMonth: total / Math.max(yearElapsedMonths, 1),
        perYear: total / Math.max(yearElapsedYears, 1),
        estimatedMinutes: agg ? Math.round(agg.ms / 60_000) : 0,
        sessions: yearSessions,
        locationCount: agg?.locs.size ?? 0,
        findsPerSession:
          yearSessions > 0 ? yearFindsInSessions / yearSessions : 0,
      });
    }
  }

  return {
    estimatedMinutes,
    sessions,
    firstFoundAt: firstFoundAt.toISOString(),
    totalFindsWithDate,
    perHour: totalFindsWithDate / Math.max(elapsedHours, 1),
    perDay: totalFindsWithDate / Math.max(elapsedDays, 1),
    perWeek: totalFindsWithDate / Math.max(elapsedWeeks, 1),
    perMonth: totalFindsWithDate / Math.max(elapsedMonths, 1),
    perYear: totalFindsWithDate / Math.max(elapsedYears, 1),
    locationCount,
    findsPerSession,
    firstYear,
    lastYear,
    perYearStats,
  };
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
             END AS location_display_name,
             (f.coordinates IS NOT NULL) AS has_gps
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
             END AS location_display_name,
             (f.coordinates IS NOT NULL) AS has_gps
      FROM finds f
      LEFT JOIN locations l ON l.id = f.location_id
      ORDER BY f.id DESC
      LIMIT 1
    `,
    // Farthest non-anonymized find from the default LocationMap's GPS
    // centre. The CTE makes the reference point optional: if MAP 00001
    // isn't on disk we still return zero rows instead of crashing.
    //
    // We don't dedupe against firstFind/lastFind here: by user request,
    // the genuine farthest find is shown even when it happens to also
    // be the latest or earliest. The "Nejvzdálenější" card frames it
    // around distance, which is its own story — repeating a find
    // between cards is fine.
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
             true AS has_gps,
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
  //
  // Sliding-window peaks (slidingHour/Day/Week) sit alongside —
  // same shape of "max count over a time window" but the window
  // floats with the data instead of snapping to calendar
  // boundaries. PostgreSQL evaluates them with a window function
  // (RANGE BETWEEN CURRENT ROW AND INTERVAL '<X>' FOLLOWING) so
  // the cost stays linear in N rather than the O(N²) you'd get
  // from a naïve self-join.
  const [
    peakMinuteRow,
    peakHourRow,
    peakDayRow,
    peakWeekRow,
    peakMonthRow,
    peakYearRow,
    slidingHourRow,
    slidingDayRow,
    slidingWeekRow,
    fastest10Row,
    fastest100Row,
    fastest1000Row,
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
    // Sliding 60-minute window. For each find, count how many other
    // finds fall in the [found_at, found_at + INTERVAL '1 hour']
    // range, then pick the row whose count is highest. The CTE
    // captures the count + window endpoints so the outer ORDER BY /
    // LIMIT can pick the winner in one shot.
    //
    // window_end uses MAX(found_at) OVER the same range so the UI
    // can render "from X to Y" instead of just "from X". The same
    // sliding window function evaluates both — single pass.
    //
    // Ties on count break by earlier window_start, same convention
    // as the calendar peaks above.
    prisma.$queryRaw<
      Array<{ window_start: Date; window_end: Date; count: bigint }>
    >`
      WITH windowed AS (
        SELECT
          found_at AS window_start,
          MAX(found_at) OVER (
            ORDER BY found_at
            RANGE BETWEEN CURRENT ROW
                      AND INTERVAL '1 hour' FOLLOWING
          ) AS window_end,
          COUNT(*) OVER (
            ORDER BY found_at
            RANGE BETWEEN CURRENT ROW
                      AND INTERVAL '1 hour' FOLLOWING
          ) AS count
        FROM finds WHERE found_at IS NOT NULL
      )
      SELECT window_start, window_end, count
      FROM windowed
      ORDER BY count DESC, window_start ASC
      LIMIT 1
    `,
    prisma.$queryRaw<
      Array<{ window_start: Date; window_end: Date; count: bigint }>
    >`
      WITH windowed AS (
        SELECT
          found_at AS window_start,
          MAX(found_at) OVER (
            ORDER BY found_at
            RANGE BETWEEN CURRENT ROW
                      AND INTERVAL '24 hours' FOLLOWING
          ) AS window_end,
          COUNT(*) OVER (
            ORDER BY found_at
            RANGE BETWEEN CURRENT ROW
                      AND INTERVAL '24 hours' FOLLOWING
          ) AS count
        FROM finds WHERE found_at IS NOT NULL
      )
      SELECT window_start, window_end, count
      FROM windowed
      ORDER BY count DESC, window_start ASC
      LIMIT 1
    `,
    prisma.$queryRaw<
      Array<{ window_start: Date; window_end: Date; count: bigint }>
    >`
      WITH windowed AS (
        SELECT
          found_at AS window_start,
          MAX(found_at) OVER (
            ORDER BY found_at
            RANGE BETWEEN CURRENT ROW
                      AND INTERVAL '7 days' FOLLOWING
          ) AS window_end,
          COUNT(*) OVER (
            ORDER BY found_at
            RANGE BETWEEN CURRENT ROW
                      AND INTERVAL '7 days' FOLLOWING
          ) AS count
        FROM finds WHERE found_at IS NOT NULL
      )
      SELECT window_start, window_end, count
      FROM windowed
      ORDER BY count DESC, window_start ASC
      LIMIT 1
    `,
    // Fastest 10 / 100 / 1000 consecutive finds. Order all dated finds
    // by time; for each, LEAD by N-1 gives the find that closes an
    // N-long stretch. The smallest (end − start) gap is the record.
    // O(N) — one window pass + a sort. The offset is a hardcoded
    // constant (Prisma.raw, no injection risk).
    fastestWindowQuery(10),
    fastestWindowQuery(100),
    fastestWindowQuery(1000),
  ]);

  return {
    minute: toPeakBucket(peakMinuteRow),
    hour: toPeakBucket(peakHourRow),
    day: toPeakBucket(peakDayRow),
    week: toPeakBucket(peakWeekRow),
    month: toPeakBucket(peakMonthRow),
    year: toPeakBucket(peakYearRow),
    slidingHour: toPeakSliding(slidingHourRow),
    slidingDay: toPeakSliding(slidingDayRow),
    slidingWeek: toPeakSliding(slidingWeekRow),
    fastest10: toPeakFastest(10, fastest10Row),
    fastest100: toPeakFastest(100, fastest100Row),
    fastest1000: toPeakFastest(1000, fastest1000Row),
  };
}

type FastestRow = {
  start_id: number;
  start_at: Date;
  end_id: number;
  end_at: Date;
  seconds: number;
};

/** Builds the fastest-N-consecutive-finds query for a given window
 *  size. `size - 1` is inlined as raw SQL (LEAD's offset must be a
 *  constant) — safe, it's a hardcoded integer. */
function fastestWindowQuery(size: number) {
  const offset = Prisma.raw(String(size - 1));
  return prisma.$queryRaw<FastestRow[]>`
    WITH ordered AS (
      SELECT id, found_at,
             LEAD(found_at, ${offset}) OVER (ORDER BY found_at, id) AS end_at,
             LEAD(id, ${offset}) OVER (ORDER BY found_at, id) AS end_id
      FROM finds
      WHERE found_at IS NOT NULL
    )
    SELECT id AS start_id, found_at AS start_at, end_id, end_at,
           EXTRACT(EPOCH FROM (end_at - found_at))::float8 AS seconds
    FROM ordered
    WHERE end_at IS NOT NULL
    ORDER BY (end_at - found_at) ASC, found_at ASC
    LIMIT 1
  `;
}

function toPeakFastest(
  size: number,
  rows: ReadonlyArray<FastestRow>,
): PeakFastestWindow | null {
  const row = rows[0];
  if (!row) return null;
  return {
    size,
    seconds: Number(row.seconds),
    startId: row.start_id,
    startsAt: row.start_at.toISOString(),
    endId: row.end_id,
    endsAt: row.end_at.toISOString(),
  };
}

/** Lift the single-row LIMIT 1 sliding-window result to the public
 *  shape, mirroring `toPeakBucket` for the calendar variant. */
function toPeakSliding(
  rows: ReadonlyArray<{
    window_start: Date;
    window_end: Date;
    count: bigint;
  }>,
): PeakSlidingWindow | null {
  const row = rows[0];
  if (!row) return null;
  return {
    startsAt: row.window_start.toISOString(),
    endsAt: row.window_end.toISOString(),
    count: Number(row.count),
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
      has_gps: boolean;
      is_donated: boolean;
    }>
  >`
    SELECT f.id, f.found_at, f.is_anonymized, f.location_id,
           CASE WHEN f.is_anonymized THEN NULL ELSE l.code END AS location_code,
           CASE WHEN f.is_anonymized THEN NULL
                ELSE COALESCE(NULLIF(l.display_name, ''), l.code)
           END AS location_display_name,
           (f.coordinates IS NOT NULL) AS has_gps,
           -- DONATED flag for the jubilee tile badge. Anonymized
           -- finds force false so the state itself stays hidden —
           -- matches the privacy stance for notes / GPS / location
           -- code everywhere else.
           CASE WHEN f.is_anonymized THEN false
                ELSE EXISTS (
                  SELECT 1 FROM find_state_assignments fsa
                  WHERE fsa.find_id = f.id AND fsa.state = 'DONATED'
                )
           END AS is_donated
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
      hasGps: r.has_gps === true,
      isDonated: r.is_donated === true,
    })),
  };
}

export async function getStatsTopLocations(): Promise<StatsTopLocationsResult> {
  const [topLocRows, topDensityRows, avgRows] = await Promise.all([
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
        -- Polygon locations use their real AOI area; polygon-less ones
        -- fall back to a 5 m-radius circle (π·r²) so they can take part
        -- in the density ranking too.
        SELECT id,
               CASE
                 WHEN polygon IS NOT NULL
                   THEN ST_Area(polygon::geography)::float8
                 ELSE pi() * (${FIND_DEVIATION_RADIUS_M} * ${FIND_DEVIATION_RADIUS_M})
               END AS area_m2
        FROM locations
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
    // Baselines beside the toggle: mean finds per location (all located
    // finds / all locations) and mean density across locations that have
    // a find (polygon area, or a 5 m circle for polygon-less ones). No
    // ≥10 threshold here — this is the whole-population average.
    prisma.$queryRaw<
      Array<{
        total_located: number;
        loc_count: number;
        avg_density: number | null;
      }>
    >`
      WITH counts AS (
        SELECT location_id, COUNT(*)::float8 AS cnt
        FROM finds
        WHERE location_id IS NOT NULL
        GROUP BY location_id
      ),
      areas AS (
        SELECT id,
               CASE
                 WHEN polygon IS NOT NULL
                   THEN ST_Area(polygon::geography)::float8
                 ELSE pi() * (${FIND_DEVIATION_RADIUS_M} * ${FIND_DEVIATION_RADIUS_M})
               END AS area_m2
        FROM locations
      )
      SELECT
        (SELECT COUNT(*) FROM finds WHERE location_id IS NOT NULL)::float8
          AS total_located,
        (SELECT COUNT(*) FROM locations)::float8 AS loc_count,
        (SELECT AVG(c.cnt / a.area_m2 * 100)
           FROM counts c
           JOIN areas a ON a.id = c.location_id
           WHERE a.area_m2 > 0)::float8 AS avg_density
    `,
  ]);
  const avg = avgRows[0];
  const locCount = avg ? Number(avg.loc_count) : 0;
  const avgFindsPerLocation =
    avg && locCount > 0 ? Number(avg.total_located) / locCount : 0;
  const avgDensityPer100m2 =
    avg && avg.avg_density !== null ? Number(avg.avg_density) : 0;
  return {
    avgFindsPerLocation,
    avgDensityPer100m2,
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
  const { byCountry, byCity, byKraj } = buildGeoBreakdowns(rows);
  return { byCountry, byCity, byKraj };
}

export async function getStatsCalendar(): Promise<StatsCalendarResult> {
  // Calendar axes — ignore time zone offsets (use the find's local
  // wall-clock the user recorded). Anonymization-stripped foundAt is
  // fine because `is_anonymized` doesn't affect the timestamp.
  const [
    yearlyRows,
    hourRows,
    dowRows,
    monthRows,
    monthDayRows,
    minuteRows,
    totalsRow,
  ] = await Promise.all([
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
    // Day-of-year × minute-of-day heatmap. Sparse — ~10-15k rows for the
    // current ~17k finds (multiple finds frequently land in the same
    // minute during a sběr session). Client buckets into 1/5/15/60 min
    // visualisations from this base.
    prisma.$queryRaw<Array<{ doy: number; mod: number; count: bigint }>>`
        SELECT EXTRACT(DOY FROM found_at)::int AS doy,
               (EXTRACT(HOUR FROM found_at)::int * 60
                + EXTRACT(MINUTE FROM found_at)::int) AS mod,
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
    byMinute: minuteRows.map((r) => ({
      doy: r.doy,
      mod: r.mod,
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
// Deviated finds — GPS that lands outside where the find "should" be.
//
// Deviation rule (mirrors /mapa's `deviated` flag and the find-detail
// offset):
//   - polygon location   → find sits OUTSIDE the AOI polygon (any
//                           distance), tested with ST_Covers.
//   - polygon-less        → find is further than FIND_DEVIATION_RADIUS_M
//                           metres from the recorded centre point.
// "Deviation distance" reuses the existing offset metric: distance to
// the nearest polygon edge for AOI locations, distance from the centre
// for polygon-less ones. Direction is the compass bearing from the
// location's centre point to the find (8-way octant). Anonymized finds
// never enter any of this (privacy — no GPS leaves the server for them).

/** Minimum non-anonymized GPS finds a location needs before it can win
 *  "highest deviation probability" — keeps a lone 1/1 = 100 % outlier
 *  from topping the chart. Matches the ≥10 floor used by topByDensity. */
const DEVIATION_TOP_LOCATION_MIN_FINDS = 10;

export interface DeviationOctant {
  /** 0 = N, 1 = NE, 2 = E, 3 = SE, 4 = S, 5 = SW, 6 = W, 7 = NW. */
  octant: number;
  count: number;
  /** Mean deviation distance (metres) of the finds in this octant, or
   *  null when the octant is empty. Drives the second ring on the
   *  compass radar (count = one ring, distance = the other). */
  meanMeters: number | null;
}

export interface DeviationTopLocation {
  id: number;
  code: string;
  displayName: string;
  total: number;
  deviated: number;
  /** deviated / total, 0..1. */
  rate: number;
}

export interface DeviationMostDeviated {
  id: number;
  meters: number;
  mode: "polygon" | "center";
  foundAt: string | null;
  location: { code: string; displayName: string } | null;
  /** Find's GPS (non-anonymized by construction). */
  findLat: number;
  findLng: number;
  /** The location's recorded centre GPS, when present. */
  locLat: number | null;
  locLng: number | null;
}

export interface StatsDeviationsResult {
  /** Non-anonymized finds with GPS AND a location that has a polygon or
   *  a centre point — the denominator for the deviation rate. */
  eligible: number;
  deviated: number;
  /** deviated / eligible, 0..1. */
  rate: number;
  medianMeters: number | null;
  meanMeters: number | null;
  /** Deviated finds whose location has a polygon (outside-AOI rule). */
  deviatedPolygon: number;
  /** Deviated finds at polygon-less locations (>radius-from-centre rule). */
  deviatedCenter: number;
  /** Dominant compass octant among deviated finds, or null when none. */
  dominantOctant: number | null;
  /** 8-bucket octant histogram (always length 8, zero-filled). */
  octants: DeviationOctant[];
  topLocation: DeviationTopLocation | null;
  mostDeviated: DeviationMostDeviated | null;
}

type DeviatedRow = {
  id: number;
  found_at: Date | null;
  mode: "polygon" | "center";
  offset_m: number | null;
  azimuth_deg: number | null;
  code: string;
  display_name: string;
  f_lat: number;
  f_lng: number;
  c_lat: number | null;
  c_lng: number | null;
};

export async function getStatsDeviations(): Promise<StatsDeviationsResult> {
  // Shared SQL predicate for "this find is deviated". Inlined into each
  // query below (Prisma raw templates can't share a fragment cleanly).
  // Kept identical to /mapa's map.ts deviated CASE.
  const [eligibleRows, deviatedRows, topRows] = await Promise.all([
    prisma.$queryRaw<Array<{ eligible: bigint }>>`
      SELECT COUNT(*)::bigint AS eligible
      FROM finds f
      JOIN locations l ON l.id = f.location_id
      WHERE f.is_anonymized = false
        AND f.coordinates IS NOT NULL
        AND (l.polygon IS NOT NULL OR l.center_point IS NOT NULL)
    `,
    prisma.$queryRaw<DeviatedRow[]>`
      SELECT f.id,
             f.found_at,
             CASE WHEN l.polygon IS NOT NULL THEN 'polygon' ELSE 'center' END AS mode,
             CASE
               WHEN l.polygon IS NOT NULL
                 THEN ST_Distance(f.coordinates::geography, l.polygon::geography)::float8
               ELSE ST_DistanceSphere(f.coordinates, l.center_point)::float8
             END AS offset_m,
             CASE
               WHEN l.center_point IS NOT NULL
                 THEN degrees(
                   ST_Azimuth(l.center_point::geography, f.coordinates::geography)
                 )::float8
             END AS azimuth_deg,
             l.code,
             COALESCE(NULLIF(l.display_name, ''), l.code) AS display_name,
             ST_Y(f.coordinates)::float8 AS f_lat,
             ST_X(f.coordinates)::float8 AS f_lng,
             ST_Y(l.center_point)::float8 AS c_lat,
             ST_X(l.center_point)::float8 AS c_lng
      FROM finds f
      JOIN locations l ON l.id = f.location_id
      WHERE f.is_anonymized = false
        AND f.coordinates IS NOT NULL
        AND (
          (l.polygon IS NOT NULL
            AND NOT ST_Covers(l.polygon::geography, f.coordinates::geography))
          OR (l.polygon IS NULL
            AND l.center_point IS NOT NULL
            AND ST_DistanceSphere(f.coordinates, l.center_point) > ${FIND_DEVIATION_RADIUS_M})
        )
      ORDER BY offset_m DESC NULLS LAST
    `,
    // Location with the highest deviation rate (≥ floor finds), skipping
    // anonymized locations so a private spot is never surfaced by name.
    prisma.$queryRaw<
      Array<{
        id: number;
        code: string;
        display_name: string;
        total: bigint;
        deviated: bigint;
      }>
    >`
      SELECT l.id,
             l.code,
             COALESCE(NULLIF(l.display_name, ''), l.code) AS display_name,
             COUNT(*)::bigint AS total,
             COUNT(*) FILTER (
               WHERE (l.polygon IS NOT NULL
                       AND NOT ST_Covers(l.polygon::geography, f.coordinates::geography))
                  OR (l.polygon IS NULL
                       AND l.center_point IS NOT NULL
                       AND ST_DistanceSphere(f.coordinates, l.center_point) > ${FIND_DEVIATION_RADIUS_M})
             )::bigint AS deviated
      FROM finds f
      JOIN locations l ON l.id = f.location_id
      WHERE f.is_anonymized = false
        AND f.coordinates IS NOT NULL
        AND (l.polygon IS NOT NULL OR l.center_point IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM location_maps lm
          WHERE lm.location_id = l.id AND lm.is_anonymized = true
        )
      GROUP BY l.id, l.code, l.display_name
      HAVING COUNT(*) >= ${DEVIATION_TOP_LOCATION_MIN_FINDS}
         AND COUNT(*) FILTER (
               WHERE (l.polygon IS NOT NULL
                       AND NOT ST_Covers(l.polygon::geography, f.coordinates::geography))
                  OR (l.polygon IS NULL
                       AND l.center_point IS NOT NULL
                       AND ST_DistanceSphere(f.coordinates, l.center_point) > ${FIND_DEVIATION_RADIUS_M})
             ) > 0
      ORDER BY
        (COUNT(*) FILTER (
          WHERE (l.polygon IS NOT NULL
                  AND NOT ST_Covers(l.polygon::geography, f.coordinates::geography))
             OR (l.polygon IS NULL
                  AND l.center_point IS NOT NULL
                  AND ST_DistanceSphere(f.coordinates, l.center_point) > ${FIND_DEVIATION_RADIUS_M})
        ))::float8 / COUNT(*) DESC,
        deviated DESC
      LIMIT 1
    `,
  ]);

  const eligible = Number(eligibleRows[0]?.eligible ?? 0n);
  const deviated = deviatedRows.length;

  // Offset stats — median + mean over the existing offset metric.
  const offsets = deviatedRows
    .map((r) => r.offset_m)
    .filter((m): m is number => m !== null && Number.isFinite(m))
    .sort((a, b) => a - b);
  const meanMeters =
    offsets.length > 0
      ? offsets.reduce((s, m) => s + m, 0) / offsets.length
      : null;
  const medianMeters =
    offsets.length === 0
      ? null
      : offsets.length % 2 === 1
        ? offsets[(offsets.length - 1) / 2]!
        : (offsets[offsets.length / 2 - 1]! + offsets[offsets.length / 2]!) / 2;

  // Location-type split.
  let deviatedPolygon = 0;
  let deviatedCenter = 0;
  for (const r of deviatedRows) {
    if (r.mode === "polygon") deviatedPolygon += 1;
    else deviatedCenter += 1;
  }

  // Octant histogram (0 = N, clockwise). Round the bearing to the
  // nearest 45° and wrap 360°→0 (N).
  const octantCounts = new Array<number>(8).fill(0);
  const octantDistSum = new Array<number>(8).fill(0);
  const octantDistN = new Array<number>(8).fill(0);
  for (const r of deviatedRows) {
    if (r.azimuth_deg === null || !Number.isFinite(r.azimuth_deg)) continue;
    const idx = ((Math.round(r.azimuth_deg / 45) % 8) + 8) % 8;
    octantCounts[idx] = (octantCounts[idx] ?? 0) + 1;
    if (r.offset_m !== null && Number.isFinite(r.offset_m)) {
      octantDistSum[idx] = (octantDistSum[idx] ?? 0) + r.offset_m;
      octantDistN[idx] = (octantDistN[idx] ?? 0) + 1;
    }
  }
  const octants: DeviationOctant[] = octantCounts.map((count, octant) => ({
    octant,
    count,
    meanMeters:
      (octantDistN[octant] ?? 0) > 0
        ? (octantDistSum[octant] ?? 0) / (octantDistN[octant] as number)
        : null,
  }));
  let dominantOctant: number | null = null;
  let best = -1;
  for (let i = 0; i < octantCounts.length; i++) {
    if ((octantCounts[i] ?? 0) > best) {
      best = octantCounts[i] ?? 0;
      dominantOctant = i;
    }
  }
  if (best <= 0) dominantOctant = null;

  // Most-deviated find — rows are already ordered by offset desc.
  const top = deviatedRows[0];
  const mostDeviated: DeviationMostDeviated | null =
    top && top.offset_m !== null
      ? {
          id: top.id,
          meters: top.offset_m,
          mode: top.mode,
          foundAt: top.found_at ? top.found_at.toISOString() : null,
          location: { code: top.code, displayName: top.display_name },
          findLat: top.f_lat,
          findLng: top.f_lng,
          locLat: top.c_lat,
          locLng: top.c_lng,
        }
      : null;

  const topRow = topRows[0];
  const topLocation: DeviationTopLocation | null = topRow
    ? {
        id: topRow.id,
        code: topRow.code,
        displayName: topRow.display_name,
        total: Number(topRow.total),
        deviated: Number(topRow.deviated),
        rate: Number(topRow.deviated) / Number(topRow.total),
      }
    : null;

  return {
    eligible,
    deviated,
    rate: eligible > 0 ? deviated / eligible : 0,
    medianMeters,
    meanMeters,
    deviatedPolygon,
    deviatedCenter,
    dominantOctant,
    octants,
    topLocation,
    mostDeviated,
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
    hasGps: row.has_gps === true,
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
  /** Finds per Czech region (kraj). Points outside ČR don't contribute. */
  byKraj: CountryPoint[];
  /** Total number of distinct cities that host at least one non-
   *  anonymized location, even if its finds are still zero. Former
   *  locations (`NEEXISTUJE-`) collapse onto the canonical city
   *  bucket — see cityFromCadastralArea — so they don't bump this
   *  count when a surviving location in the same town already does,
   *  but a town that exists ONLY as former locations still counts as
   *  1 city. Used by the corner card on /statistiky. */
  cityCount: number;
  /** Total number of distinct countries that host at least one
   *  non-anonymized location with GPS, even if no finds yet. */
  countryCount: number;
} {
  const countryAcc = new Map<string, { name: string; count: number }>();
  const krajAcc = new Map<string, { name: string; count: number }>();
  const cityAcc = new Map<string, number>();

  for (const r of rows) {
    const c = Number(r.count);
    // Bucket by the canonical city — `cityFromCadastralArea` strips
    // the `NEEXISTUJE-` prefix so a town with both surviving and
    // former locations counts once. The same helper drives the
    // dropdown on /sbirka and /lokality, so the count card here lines
    // up with the number of city entries the operator sees in the
    // filter UI.
    //
    // No c > 0 gate: a city is registered as soon as a location exists
    // there, even with zero finds. geoLocRows comes from a LEFT JOIN
    // so empty locations contribute count = 0 (still bumps the
    // dictionary entry). The byCity / byCountry arrays returned to
    // the table renderer then re-filter to count > 0 so empty places
    // don't clutter the breakdown.
    const cityKey = cityFromCadastralArea(r.cadastral) || r.code;
    if (cityKey) {
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
      // Czech regions: only points inside ČR resolve to a kraj.
      const kraj = czRegionFromCoords(r.lat, r.lng);
      if (kraj) {
        const pk = krajAcc.get(kraj.code);
        if (pk) pk.count += c;
        else krajAcc.set(kraj.code, { name: kraj.name, count: c });
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

  const byKraj: CountryPoint[] = [...krajAcc.entries()]
    .filter(([, v]) => v.count > 0)
    .map(([code, v]) => ({ code, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "cs"));

  return { byCountry, byCity, byKraj, cityCount, countryCount };
}
