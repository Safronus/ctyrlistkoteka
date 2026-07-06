/**
 * Aggregated data backing the home page. Returns a compact bundle so
 * the home view can render numbers, the latest find with thumbnail, and
 * a 12-month sparkline without making the heavier `getCollectionStats()`
 * call. Anonymized data is filtered/redacted at the SQL layer per
 * CLAUDE.md §6 — no raw notes or precise GPS leave the server.
 */

import type { FindState } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import {
  MISSING_CLOVER_ID_MAX,
  MISSING_CLOVER_ID_MIN,
  STATS_REVALIDATE,
} from "@/lib/constants";
import { countryFromCoords } from "@/lib/geo";
import { isFormerLocation } from "@/lib/locationCode";
import type { PublicImage } from "./finds";

export interface CollectionFreshness {
  /** Most recent find INSERT (created_at), ISO. Anchors the footer's
   *  "Poslední aktualizace sbírky". */
  latestCreatedAt: string | null;
  /** How many finds the latest upload added at the top of the collection. */
  latestFoundCount: number;
  /** Earliest find INSERT (created_at), ISO — the founding date. */
  firstCreatedAt: string | null;
  /** Most recent gap-filler INSERT in the historical id window, ISO. */
  lastBackfillCreatedAt: string | null;
  /** Finds in that last backfill batch (same Prague day). */
  lastBackfillCount: number;
}

/**
 * Just the collection-freshness numbers, so the site-wide footer can show
 * "Poslední aktualizace sbírky" without pulling the heavy getHomePageData()
 * bundle on every page. The SQL mirrors the freshness parts of that query
 * (kept in sync deliberately); wrapped in `unstable_cache` under the "stats"
 * tag so a sync's revalidation refreshes it too.
 */
async function getCollectionFreshnessImpl(): Promise<CollectionFreshness> {
  const [countsRows, backfillRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        first_created_at: Date | null;
        latest_created_at: Date | null;
        latest_found_count: number;
      }>
    >`
      SELECT
        (SELECT MIN(created_at) FROM finds) AS first_created_at,
        (SELECT MAX(created_at) FROM finds) AS latest_created_at,
        (
          WITH lu AS (
            SELECT (MAX(created_at) AT TIME ZONE 'Europe/Prague')::date AS d
            FROM finds
          ),
          pm AS (
            SELECT COALESCE(MAX(f.id), 0) AS pmax
            FROM finds f, lu
            WHERE (f.created_at AT TIME ZONE 'Europe/Prague')::date < lu.d
          )
          SELECT COUNT(*)::int
          FROM finds f, lu, pm
          WHERE (f.created_at AT TIME ZONE 'Europe/Prague')::date = lu.d
            AND f.id > pm.pmax
        ) AS latest_found_count
    `,
    prisma.$queryRaw<
      Array<{ last_backfill_at: Date | null; last_backfill_count: number }>
    >`
      WITH last AS (
        SELECT MAX(created_at) AS last_at
        FROM finds
        WHERE id >= ${MISSING_CLOVER_ID_MIN} AND id <= ${MISSING_CLOVER_ID_MAX}
      )
      SELECT
        last.last_at AS last_backfill_at,
        (
          SELECT COUNT(*)::int
          FROM finds f
          WHERE f.id >= ${MISSING_CLOVER_ID_MIN}
            AND f.id <= ${MISSING_CLOVER_ID_MAX}
            AND last.last_at IS NOT NULL
            AND (f.created_at AT TIME ZONE 'Europe/Prague')::date
                = (last.last_at AT TIME ZONE 'Europe/Prague')::date
        ) AS last_backfill_count
      FROM last
    `,
  ]);
  const c = countsRows[0];
  const b = backfillRows[0];
  return {
    latestCreatedAt: c?.latest_created_at
      ? c.latest_created_at.toISOString()
      : null,
    latestFoundCount: c ? Number(c.latest_found_count) : 0,
    firstCreatedAt: c?.first_created_at
      ? c.first_created_at.toISOString()
      : null,
    lastBackfillCreatedAt: b?.last_backfill_at
      ? b.last_backfill_at.toISOString()
      : null,
    lastBackfillCount: b ? Number(b.last_backfill_count) : 0,
  };
}

export const getCollectionFreshness = unstable_cache(
  getCollectionFreshnessImpl,
  ["collection-freshness"],
  { revalidate: STATS_REVALIDATE, tags: ["stats"] },
);

export interface HomeLatestFind {
  id: number;
  foundAt: string | null;
  isAnonymized: boolean;
  /** Null when the find is anonymized — code/displayName must not leak. */
  location: { id: number; code: string; displayName: string } | null;
  /** Raw GPS, *only* for non-anonymized finds. The SQL query already
   *  hard-NULLs the value for anonymized rows so a leak via this field
   *  isn't possible. Null also when the find simply has no GPS recorded. */
  coordinates: { lat: number; lng: number } | null;
  /** Photo of the find. The image itself doesn't reveal identity, so it
   *  is shown for anonymized finds too — same rule the /sbirka grid
   *  follows. Null when the find has no image (e.g. NO_PHOTO state).
   *  Shape matches `PublicImage` so the existing `FindThumbnail`
   *  component renders it without adapting. */
  primaryImage: PublicImage | null;
  /** CROP image (the magnified leaf cut-out) for the lupa magnifier overlay,
   *  same as the random-clover showcase. Null when the find has no crop.
   *  Like primaryImage it doesn't reveal identity, so it's fine for
   *  anonymized finds too. */
  cropImage: PublicImage | null;
  /** Find states for the badge row — public even for anonymized finds
   *  (the ANONYMIZED badge itself is shown), same as the /sbirka grid. */
  states: FindState[];
}

export interface HomeTotals {
  /** Total count of `finds` rows in the DB — the actual number of
   *  finds the project has uploaded photos for. Used as the small
   *  "X nahraných" hint under the headline number. */
  finds: number;
  /** Maximum `find.id` in the DB. Drives the headline number on the
   *  home page tile — represents the "highest find number we've
   *  reached" rather than the count, because the user numbers
   *  chronologically and the count diverges from the max when older
   *  finds get backfilled later (ID 17000 exists but the count is
   *  only 16800 because 200 historic finds haven't been uploaded
   *  yet). Null when the table is empty. */
  maxFindId: number | null;
  locations: number;
  cities: number;
  countries: number;
  /** Distinct finds tagged with the DONATED state — the count behind
   *  the "rozcházející se lístky" showcase at the bottom of the home
   *  page. Same definition as `donatedFinds` on /statistiky. */
  donated: number;
  /** found_at (EXIF find date+time) of the most-recently-found DONATED find
   *  (ISO) — the "naposledy darováno" timestamp under the donated showcase.
   *  Null when nothing is donated yet (or none carry a find date). */
  lastDonatedAt: string | null;
  /** Inclusive count of distinct calendar years that contain at least
   *  one find — same definition as the existing `yearsSpan` on the home
   *  stat card, kept stable for the card label's pluralisation. */
  yearsSpan: number | null;
  /** ISO date of the most recently dated find. Drives the "Poslední
   *  nález" date hint on the home stat row. */
  latestFoundAt: string | null;
  /** ISO timestamp of the most recent upload (MAX created_at). Drives the
   *  "Poslední aktualizace sbírky" line — when the collection last grew on
   *  the web, not the newest EXIF found date. */
  latestCreatedAt: string | null;
  /** How many finds the most recent upload added at the TOP of the
   *  collection — finds inserted on the latest created_at day
   *  (Europe/Prague) whose id is higher than the max id that existed
   *  before that upload. Spans however many found-days the batch covers
   *  (it's "what the last upload added", not a single found day). Shown
   *  next to the "Poslední aktualizace sbírky" line. Backfill (ids below
   *  the prior max) is excluded — that's the lastBackfill fields. */
  latestFoundCount: number;
  /** ISO timestamp of the most recent INSERT of a find whose ID falls in
   *  the historical "missing clovers" window (MISSING_CLOVER_ID_MIN..MAX
   *  in constants.ts) — i.e. when the user last uploaded an older
   *  gap-filling find. New finds added above that window don't affect
   *  it. Null when the table has no find in the range. */
  lastBackfillCreatedAt: string | null;
  /** How many gap-window finds were uploaded in that last backfill —
   *  counted as the finds in the range whose `created_at` falls on the
   *  same calendar day (Europe/Prague) as `lastBackfillCreatedAt`. Sync
   *  inserts gap fills one row at a time (no shared batch timestamp), so
   *  same-day is the robust proxy for "the last upload". 0 when the
   *  range is empty. */
  lastBackfillCount: number;
}

export interface HomeHighlights {
  /** Year of the user's first find — anchors the "od roku N" tagline. */
  firstYear: number | null;
  /** ISO timestamp of the user's earliest find. Drives the precise
   *  "before X years, Y days, Z hours" hint below the headline year. */
  firstFoundAt: string | null;
  /** ISO timestamp of the first upload (MIN created_at). Drives the
   *  "První čtyřlístek zaevidován" line — when the earliest clover was
   *  first written to the web, not its EXIF found date. */
  firstCreatedAt: string | null;
  /** Single calendar day with the most finds. Mirrors the `peaks.day`
   *  bucket used on /statistiky. */
  peakDay: {
    startsAt: string;
    count: number;
    /** ISO string of the FIRST find captured on that day — wall-clock
     *  time straight from EXIF DateTimeOriginal, no aggregation. Used
     *  by the home tile to show "od HH:MM". */
    firstAt: string;
    /** ISO string of the LAST find captured on that day. Pair with
     *  firstAt to display the daily harvest window + its duration. */
    lastAt: string;
    /** "Net" picking time on that day in MINUTES, summed across each
     *  location's sessions. A new session starts inside the same
     *  location whenever there's a gap > SESSION_GAP_MIN between two
     *  consecutive finds — that's how the user describes their
     *  workflow (a few minutes between clovers within one bout, longer
     *  break = independent visit). Single-find sessions contribute 0
     *  because there's no second timestamp to measure against. */
    netMinutes: number;
  } | null;
  /** #1 location by find count, with parent/child folding identical to
   *  the /statistiky TOP 10 (so a parent shows the combined total of
   *  its sub-parts). Anonymized locations are excluded. */
  topLocation: {
    id: number;
    code: string;
    displayName: string;
    count: number;
    /** Net picking time across the whole history of this location
     *  (incl. its sub-parts), summed per (location, day) session.
     *  Same session math as `peakDay.netMinutes` — see SESSION_GAP_MS
     *  / SESSION_BASELINE_MS for the constants. Always >= 0; a single
     *  isolated find still gets the per-session baseline. */
    netMinutes: number;
  } | null;
}

export interface HomeMonthlyPoint {
  /** "YYYY-MM". */
  month: string;
  count: number;
}

export interface HomePageData {
  totals: HomeTotals;
  latestFind: HomeLatestFind | null;
  /** The very first find (lowest id) — shown next to latestFind in the
   *  "První vs poslední čtyřlístek" section. Same shape as latestFind.
   *  Null only when the collection is empty (then latestFind is null
   *  too). Equals latestFind when there's exactly one find. */
  firstFind: HomeLatestFind | null;
  highlights: HomeHighlights;
  /** Last 12 calendar months ending with the current month, padded with
   *  zero-count entries for months without finds so the sparkline keeps
   *  a uniform x-axis. */
  recentMonthly: HomeMonthlyPoint[];
}

export async function getHomePageData(): Promise<HomePageData> {
  const [
    countsRows,
    latestFindRow,
    latestCoordRows,
    firstFindRow,
    firstCoordRows,
    peakDayRows,
    topLocRows,
    monthlyRows,
    geoLocRows,
    backfillRows,
  ] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        finds: bigint;
        max_find_id: number | null;
        locations: bigint;
        donated: bigint;
        last_donated_at: Date | null;
        first_year: number | null;
        last_year: number | null;
        first_found_at: Date | null;
        latest_found_at: Date | null;
        first_created_at: Date | null;
        latest_created_at: Date | null;
        latest_found_count: number;
      }>
    >`
      SELECT
        (SELECT COUNT(*) FROM finds) AS finds,
        (SELECT MAX(id) FROM finds) AS max_find_id,
        (SELECT COUNT(*) FROM locations) AS locations,
        (SELECT COUNT(DISTINCT find_id) FROM find_state_assignments
           WHERE state = 'DONATED') AS donated,
        -- Find date+time (EXIF found_at) of the most-recently-found DONATED
        -- clover — powers the "naposledy darováno" line under the donated
        -- showcase. Uses found_at (the clover's own find moment), NOT
        -- created_at; NULL found_at rows are ignored by MAX.
        (SELECT MAX(f.found_at) FROM finds f
           JOIN find_state_assignments fsa ON fsa.find_id = f.id
           WHERE fsa.state = 'DONATED') AS last_donated_at,
        (SELECT EXTRACT(YEAR FROM MIN(found_at))::int FROM finds) AS first_year,
        (SELECT EXTRACT(YEAR FROM MAX(found_at))::int FROM finds) AS last_year,
        (SELECT MIN(found_at) FROM finds) AS first_found_at,
        (SELECT MAX(found_at) FROM finds) AS latest_found_at,
        -- Upload timestamps: created_at is when sync wrote the row to the DB
        -- (when the clover reached the web), NOT the EXIF found date.
        -- first_created_at anchors "První čtyřlístek zaevidován";
        -- latest_created_at anchors "Poslední aktualizace sbírky".
        (SELECT MIN(created_at) FROM finds) AS first_created_at,
        (SELECT MAX(created_at) FROM finds) AS latest_created_at,
        -- "Last update" = how many finds the most recent upload added at
        -- the TOP of the collection: finds inserted on the latest
        -- created_at calendar day (Europe/Prague) whose id is higher than
        -- the max id that existed before that upload. Spans however many
        -- found-days the batch covers — it's about the upload, not a
        -- single found day. Backfill (ids at/below the prior max) is
        -- excluded; it's tracked by the lastBackfill fields below.
        (
          WITH lu AS (
            SELECT (MAX(created_at) AT TIME ZONE 'Europe/Prague')::date AS d
            FROM finds
          ),
          pm AS (
            SELECT COALESCE(MAX(f.id), 0) AS pmax
            FROM finds f, lu
            WHERE (f.created_at AT TIME ZONE 'Europe/Prague')::date < lu.d
          )
          SELECT COUNT(*)::int
          FROM finds f, lu, pm
          WHERE (f.created_at AT TIME ZONE 'Europe/Prague')::date = lu.d
            AND f.id > pm.pmax
        ) AS latest_found_count
    `,

    // Most recent find by ID. Fetch its images (ORIGINAL + CROP, no `take`)
    // so the "První vs poslední" photo can render both the primary photo and
    // the lupa magnifier's crop, like the random-clover showcase.
    prisma.find.findFirst({
      orderBy: { id: "desc" },
      select: {
        id: true,
        foundAt: true,
        isAnonymized: true,
        location: { select: { id: true, code: true, displayName: true } },
        states: { select: { state: true } },
        images: {
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
          select: {
            id: true,
            imageType: true,
            webPath: true,
            thumbPath: true,
            width: true,
            height: true,
            isPrimary: true,
            sortOrder: true,
          },
        },
      },
    }),

    // Raw GPS for the latest find. The Prisma query above can't reach
    // the PostGIS `coordinates` column (it's `Unsupported("geometry")`),
    // so we read it via raw SQL and hard-NULL it for anonymized rows on
    // the server side. No `is_anonymized = false` filter on the WHERE
    // because we still want a row back when the latest find is
    // anonymized (so the latestFind card itself renders) — the CASE
    // wipes the lat/lng instead.
    prisma.$queryRaw<Array<{ lat: number | null; lng: number | null }>>`
      SELECT
        CASE WHEN is_anonymized = false AND coordinates IS NOT NULL
             THEN ST_Y(coordinates)::float8 END AS lat,
        CASE WHEN is_anonymized = false AND coordinates IS NOT NULL
             THEN ST_X(coordinates)::float8 END AS lng
      FROM finds
      WHERE id = (SELECT MAX(id) FROM finds)
    `,

    // First find by ID (mirror of the latest-find query above), for the
    // "První vs poslední" section.
    prisma.find.findFirst({
      orderBy: { id: "asc" },
      select: {
        id: true,
        foundAt: true,
        isAnonymized: true,
        location: { select: { id: true, code: true, displayName: true } },
        states: { select: { state: true } },
        images: {
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
          select: {
            id: true,
            imageType: true,
            webPath: true,
            thumbPath: true,
            width: true,
            height: true,
            isPrimary: true,
            sortOrder: true,
          },
        },
      },
    }),

    // Raw GPS for the first find — same anonymized-safe CASE as latest.
    prisma.$queryRaw<Array<{ lat: number | null; lng: number | null }>>`
      SELECT
        CASE WHEN is_anonymized = false AND coordinates IS NOT NULL
             THEN ST_Y(coordinates)::float8 END AS lat,
        CASE WHEN is_anonymized = false AND coordinates IS NOT NULL
             THEN ST_X(coordinates)::float8 END AS lng
      FROM finds
      WHERE id = (SELECT MIN(id) FROM finds)
    `,

    prisma.$queryRaw<
      Array<{
        bucket: Date;
        count: bigint;
        first_at: Date;
        last_at: Date;
      }>
    >`
      SELECT date_trunc('day', found_at) AS bucket,
             COUNT(*) AS count,
             MIN(found_at) AS first_at,
             MAX(found_at) AS last_at
      FROM finds WHERE found_at IS NOT NULL
      GROUP BY 1 ORDER BY count DESC, bucket ASC LIMIT 1
    `,

    // Top location with parent/child folding — identical CTE to the
    // /statistiky TOP 10 query; we just LIMIT 1 here.
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
      LIMIT 1
    `,

    // Last 12 calendar months. We grab only the rows that exist; the
    // post-processing step pads missing months with zeros so a quiet
    // month doesn't collapse the sparkline's x-axis.
    prisma.$queryRaw<Array<{ month: Date; count: bigint }>>`
      SELECT date_trunc('month', found_at)::date AS month, COUNT(*) AS count
      FROM finds
      WHERE found_at IS NOT NULL
        AND found_at >= date_trunc('month', NOW()) - interval '11 months'
      GROUP BY 1
      ORDER BY 1
    `,

    // Per-location aggregate used to derive distinct city / country
    // counts. Anonymized locations are filtered out (their precise GPS
    // is private). Vanished places are still returned so the country
    // tally counts them; the city tally drops them in the post-process.
    prisma.$queryRaw<
      Array<{
        code: string;
        cadastral: string;
        lat: number | null;
        lng: number | null;
      }>
    >`
      SELECT l.code,
             l.cadastral_area AS cadastral,
             CASE WHEN l.center_point IS NOT NULL
                  THEN ST_Y(l.center_point)::float8 END AS lat,
             CASE WHEN l.center_point IS NOT NULL
                  THEN ST_X(l.center_point)::float8 END AS lng
      FROM locations l
      WHERE l.id NOT IN (
        SELECT DISTINCT location_id FROM location_maps WHERE is_anonymized = true
      )
    `,

    // "Last backfill" — most recent INSERT of a find whose ID sits in
    // the historical "missing clovers" window
    // (MISSING_CLOVER_ID_MIN..MAX). Only gap-fillers in that fixed range
    // count: new finds added at the high end (id > MAX) don't move this
    // status, and neither do the already-complete low ids (< MIN). The
    // earlier "id below the running max" heuristic falsely tripped on
    // batch uploads whose created_at order didn't match id order.
    // created_at is the first-insert time (upserts don't touch it), so
    // MAX(created_at) over the range = when the last gap-filler landed.
    prisma.$queryRaw<
      Array<{ last_backfill_at: Date | null; last_backfill_count: number }>
    >`
      WITH last AS (
        SELECT MAX(created_at) AS last_at
        FROM finds
        WHERE id >= ${MISSING_CLOVER_ID_MIN} AND id <= ${MISSING_CLOVER_ID_MAX}
      )
      SELECT
        last.last_at AS last_backfill_at,
        (
          -- Count gap-window finds inserted on the SAME calendar day
          -- (Europe/Prague) as the most recent one = the last upload
          -- batch. Per-row created_at means there's no shared batch
          -- timestamp, so same-day is the robust grouping.
          SELECT COUNT(*)::int
          FROM finds f
          WHERE f.id >= ${MISSING_CLOVER_ID_MIN}
            AND f.id <= ${MISSING_CLOVER_ID_MAX}
            AND last.last_at IS NOT NULL
            AND (f.created_at AT TIME ZONE 'Europe/Prague')::date
                = (last.last_at AT TIME ZONE 'Europe/Prague')::date
        ) AS last_backfill_count
      FROM last
    `,
  ]);

  const c = countsRows[0];
  const yearsSpan =
    c && c.first_year !== null && c.last_year !== null
      ? c.last_year - c.first_year + 1
      : null;

  const cityKeys = new Set<string>();
  const countryKeys = new Set<string>();
  for (const r of geoLocRows) {
    if (!isFormerLocation(r.code)) {
      cityKeys.add(r.cadastral || r.code);
    }
    if (r.lat !== null && r.lng !== null) {
      countryKeys.add(countryFromCoords(r.lat, r.lng).code);
    }
  }

  const lastBackfill = backfillRows[0]?.last_backfill_at ?? null;
  const lastBackfillCount = backfillRows[0]?.last_backfill_count ?? 0;
  const totals: HomeTotals = {
    finds: c ? Number(c.finds) : 0,
    maxFindId: c?.max_find_id ?? null,
    locations: c ? Number(c.locations) : 0,
    cities: cityKeys.size,
    countries: countryKeys.size,
    donated: c ? Number(c.donated) : 0,
    lastDonatedAt: c?.last_donated_at ? c.last_donated_at.toISOString() : null,
    yearsSpan,
    latestFoundAt: c?.latest_found_at ? c.latest_found_at.toISOString() : null,
    latestCreatedAt: c?.latest_created_at
      ? c.latest_created_at.toISOString()
      : null,
    latestFoundCount: c ? Number(c.latest_found_count) : 0,
    lastBackfillCreatedAt: lastBackfill ? lastBackfill.toISOString() : null,
    lastBackfillCount: Number(lastBackfillCount),
  };

  const toHomeFind = (
    row: typeof latestFindRow,
    coord: { lat: number | null; lng: number | null } | undefined,
  ): HomeLatestFind | null =>
    row
      ? {
          id: row.id,
          foundAt: row.foundAt ? row.foundAt.toISOString() : null,
          isAnonymized: row.isAnonymized,
          location: row.isAnonymized ? null : row.location,
          coordinates:
            coord && coord.lat !== null && coord.lng !== null
              ? { lat: coord.lat, lng: coord.lng }
              : null,
          primaryImage:
            row.images.find((i) => i.imageType === "ORIGINAL") ??
            row.images[0] ??
            null,
          cropImage: row.images.find((i) => i.imageType === "CROP") ?? null,
          states: row.states.map((s) => s.state),
        }
      : null;

  const latestFind = toHomeFind(latestFindRow, latestCoordRows[0]);
  const firstFind = toHomeFind(firstFindRow, firstCoordRows[0]);

  const peakDayRow = peakDayRows[0];
  const topLocRow = topLocRows[0];
  // Net picking time = sum of within-location session durations on the
  // peak day. A "session" is a run of finds inside one location whose
  // consecutive gaps stay under SESSION_GAP_MS (chosen at 15 min — the
  // user noted "pár minut" between picks in one place, with > 10–15
  // min meaning a new visit). Two extra round-trips would be wasteful
  // here, so we pull the peak day's rows once and fold the math in JS.
  // The top-location card uses the same math but bucketed by
  // (location, day) so a multi-day location still respects the
  // session boundaries.
  const [peakNetMinutes, topLocNetMinutes] = await Promise.all([
    peakDayRow ? computePeakDayNetMinutes(peakDayRow.bucket) : Promise.resolve(0),
    topLocRow
      ? computeNetMinutesForLocationTree(topLocRow.id)
      : Promise.resolve(0),
  ]);
  const highlights: HomeHighlights = {
    firstYear: c?.first_year ?? null,
    firstFoundAt: c?.first_found_at ? c.first_found_at.toISOString() : null,
    firstCreatedAt: c?.first_created_at
      ? c.first_created_at.toISOString()
      : null,
    peakDay: peakDayRow
      ? {
          startsAt: peakDayRow.bucket.toISOString(),
          count: Number(peakDayRow.count),
          firstAt: peakDayRow.first_at.toISOString(),
          lastAt: peakDayRow.last_at.toISOString(),
          netMinutes: peakNetMinutes,
        }
      : null,
    topLocation: topLocRow
      ? {
          id: topLocRow.id,
          code: topLocRow.code,
          displayName: topLocRow.name,
          count: Number(topLocRow.count),
          netMinutes: topLocNetMinutes,
        }
      : null,
  };

  return {
    totals,
    latestFind,
    firstFind,
    highlights,
    recentMonthly: padMonthlySparkline(monthlyRows),
  };
}

/** A new session opens once two consecutive finds inside one location
 *  are this far apart. 15 min is the upper end of the user's described
 *  workflow ("pár minut" within one bout); longer = independent visit
 *  to the same place. */
const SESSION_GAP_MS = 15 * 60 * 1000;

/** Time spent before the first find of each session — walking up to
 *  the spot, scanning the area, etc. Added once per session so a
 *  single-find session is still credited some duration (otherwise its
 *  spread is 0 and the find vanishes from "net time"). Kept in sync
 *  with the same constant on /statistiky aggregate. */
export const SESSION_BASELINE_MS = 2 * 60 * 1000;

async function computePeakDayNetMinutes(dayBucket: Date): Promise<number> {
  // Pull every find on the peak day with its location + timestamp,
  // sorted so the session walker can stream through each location's
  // run in one pass. Anonymized state doesn't matter for the math —
  // we never expose the rows themselves, only the summed minute count.
  const rows = await prisma.$queryRaw<
    Array<{ location_id: number | null; found_at: Date }>
  >`
    SELECT location_id, found_at
    FROM finds
    WHERE found_at IS NOT NULL
      AND date_trunc('day', found_at) = ${dayBucket}
    ORDER BY location_id NULLS LAST, found_at ASC
  `;

  // Bucket timestamps by location. Rows with NULL location_id are
  // dropped — without a location we can't tell whether two finds
  // belong to the same picking bout, and forcing them all into one
  // pseudo-bucket would inflate the duration.
  const byLoc = new Map<number, number[]>();
  for (const r of rows) {
    if (r.location_id === null) continue;
    const arr = byLoc.get(r.location_id);
    const ts = r.found_at.getTime();
    if (arr) arr.push(ts);
    else byLoc.set(r.location_id, [ts]);
  }

  let totalMs = 0;
  let sessionsCount = 0;
  for (const ts of byLoc.values()) {
    if (ts.length === 0) continue;
    let sessionStart = ts[0]!;
    let prev = sessionStart;
    for (let i = 1; i < ts.length; i++) {
      const cur = ts[i]!;
      if (cur - prev > SESSION_GAP_MS) {
        // Close the current session, open a new one. Single-find
        // sessions contribute 0 timestamp spread — the baseline below
        // still credits them with the per-session warm-up time.
        totalMs += prev - sessionStart;
        sessionsCount += 1;
        sessionStart = cur;
      }
      prev = cur;
    }
    totalMs += prev - sessionStart;
    sessionsCount += 1;
  }

  // Add the per-session baseline once it's known how many sessions
  // we actually counted — handles single-find sessions and gives
  // every multi-find session a credit for the time before its first
  // EXIF stamp (walking to the spot + scanning).
  totalMs += sessionsCount * SESSION_BASELINE_MS;

  return Math.round(totalMs / 60_000);
}

/** Total net picking time spent at one location (folding parent →
 *  children, mirrors the topLocRows CTE), summed per (location, day)
 *  session. Pull every find that belongs to the location subtree, then
 *  fold the same SESSION_GAP_MS / SESSION_BASELINE_MS arithmetic the
 *  peak-day variant uses. Returns 0 when the subtree has no dated
 *  finds. */
async function computeNetMinutesForLocationTree(
  rootLocationId: number,
): Promise<number> {
  const rows = await prisma.$queryRaw<
    Array<{ day: Date; found_at: Date; location_id: number }>
  >`
    SELECT date_trunc('day', f.found_at) AS day,
           f.found_at,
           f.location_id
    FROM finds f
    LEFT JOIN locations l ON l.id = f.location_id
    WHERE f.found_at IS NOT NULL
      AND (f.location_id = ${rootLocationId} OR l.parent_id = ${rootLocationId})
    ORDER BY f.location_id, day, f.found_at ASC
  `;

  // Bucket by (location_id, day) — sessions are scoped to one place
  // on one calendar day. Two visits to the same spot on different
  // days would otherwise merge across the date boundary if the second
  // happened to start within the gap window.
  const byBucket = new Map<string, number[]>();
  for (const r of rows) {
    const k = `${r.location_id}|${r.day.getTime()}`;
    const arr = byBucket.get(k);
    const ts = r.found_at.getTime();
    if (arr) arr.push(ts);
    else byBucket.set(k, [ts]);
  }

  let totalMs = 0;
  let sessionsCount = 0;
  for (const ts of byBucket.values()) {
    if (ts.length === 0) continue;
    let sessionStart = ts[0]!;
    let prev = sessionStart;
    for (let i = 1; i < ts.length; i++) {
      const cur = ts[i]!;
      if (cur - prev > SESSION_GAP_MS) {
        totalMs += prev - sessionStart;
        sessionsCount += 1;
        sessionStart = cur;
      }
      prev = cur;
    }
    totalMs += prev - sessionStart;
    sessionsCount += 1;
  }
  totalMs += sessionsCount * SESSION_BASELINE_MS;
  return Math.round(totalMs / 60_000);
}

/**
 * Pads a sparse list of monthly aggregates into a contiguous 12-element
 * series ending with the current calendar month. Missing months get
 * `count = 0` so the sparkline's x-axis stays uniform regardless of
 * which months actually contain data.
 */
function padMonthlySparkline(
  rows: ReadonlyArray<{ month: Date; count: bigint }>,
): HomeMonthlyPoint[] {
  const found = new Map<string, number>();
  for (const r of rows) {
    found.set(r.month.toISOString().slice(0, 7), Number(r.count));
  }

  const now = new Date();
  const out: HomeMonthlyPoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({ month: key, count: found.get(key) ?? 0 });
  }
  return out;
}
