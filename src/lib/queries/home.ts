/**
 * Aggregated data backing the home page. Returns a compact bundle so
 * the home view can render numbers, the latest find with thumbnail, and
 * a 12-month sparkline without making the heavier `getCollectionStats()`
 * call. Anonymized data is filtered/redacted at the SQL layer per
 * CLAUDE.md §6 — no raw notes or precise GPS leave the server.
 */

import { prisma } from "@/lib/db";
import { countryFromCoords } from "@/lib/geo";
import { isFormerLocation } from "@/lib/locationCode";
import type { PublicImage } from "./finds";

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
}

export interface HomeTotals {
  finds: number;
  locations: number;
  cities: number;
  countries: number;
  /** Inclusive count of distinct calendar years that contain at least
   *  one find — same definition as the existing `yearsSpan` on the home
   *  stat card, kept stable for the card label's pluralisation. */
  yearsSpan: number | null;
  /** ISO date of the most recently dated find. Drives the "Poslední
   *  nález" date hint on the home stat row. */
  latestFoundAt: string | null;
}

export interface HomeHighlights {
  /** Year of the user's first find — anchors the "od roku N" tagline. */
  firstYear: number | null;
  /** ISO timestamp of the user's earliest find. Drives the precise
   *  "before X years, Y days, Z hours" hint below the headline year. */
  firstFoundAt: string | null;
  /** Single calendar day with the most finds. Mirrors the `peaks.day`
   *  bucket used on /statistiky. */
  peakDay: { startsAt: string; count: number } | null;
  /** #1 location by find count, with parent/child folding identical to
   *  the /statistiky TOP 10 (so a parent shows the combined total of
   *  its sub-parts). Anonymized locations are excluded. */
  topLocation: {
    id: number;
    code: string;
    displayName: string;
    count: number;
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
    peakDayRows,
    topLocRows,
    monthlyRows,
    geoLocRows,
  ] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        finds: bigint;
        locations: bigint;
        first_year: number | null;
        last_year: number | null;
        first_found_at: Date | null;
        latest_found_at: Date | null;
      }>
    >`
      SELECT
        (SELECT COUNT(*) FROM finds) AS finds,
        (SELECT COUNT(*) FROM locations) AS locations,
        (SELECT EXTRACT(YEAR FROM MIN(found_at))::int FROM finds) AS first_year,
        (SELECT EXTRACT(YEAR FROM MAX(found_at))::int FROM finds) AS last_year,
        (SELECT MIN(found_at) FROM finds) AS first_found_at,
        (SELECT MAX(found_at) FROM finds) AS latest_found_at
    `,

    // Most recent find by ID. The `images` `take: 1` with sort orders
    // mirrors `LIST_INCLUDE` in finds.ts so we get the same primary
    // image the /sbirka grid would show.
    prisma.find.findFirst({
      orderBy: { id: "desc" },
      select: {
        id: true,
        foundAt: true,
        isAnonymized: true,
        location: { select: { id: true, code: true, displayName: true } },
        images: {
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
          take: 1,
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

    prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
      SELECT date_trunc('day', found_at) AS bucket, COUNT(*) AS count
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

  const totals: HomeTotals = {
    finds: c ? Number(c.finds) : 0,
    locations: c ? Number(c.locations) : 0,
    cities: cityKeys.size,
    countries: countryKeys.size,
    yearsSpan,
    latestFoundAt: c?.latest_found_at ? c.latest_found_at.toISOString() : null,
  };

  const lf = latestFindRow;
  const latestCoord = latestCoordRows[0];
  const latestFind: HomeLatestFind | null = lf
    ? {
        id: lf.id,
        foundAt: lf.foundAt ? lf.foundAt.toISOString() : null,
        isAnonymized: lf.isAnonymized,
        location: lf.isAnonymized ? null : lf.location,
        coordinates:
          latestCoord && latestCoord.lat !== null && latestCoord.lng !== null
            ? { lat: latestCoord.lat, lng: latestCoord.lng }
            : null,
        primaryImage: lf.images[0] ?? null,
      }
    : null;

  const peakDayRow = peakDayRows[0];
  const topLocRow = topLocRows[0];
  const highlights: HomeHighlights = {
    firstYear: c?.first_year ?? null,
    firstFoundAt: c?.first_found_at ? c.first_found_at.toISOString() : null,
    peakDay: peakDayRow
      ? {
          startsAt: peakDayRow.bucket.toISOString(),
          count: Number(peakDayRow.count),
        }
      : null,
    topLocation: topLocRow
      ? {
          id: topLocRow.id,
          code: topLocRow.code,
          displayName: topLocRow.name,
          count: Number(topLocRow.count),
        }
      : null,
  };

  return {
    totals,
    latestFind,
    highlights,
    recentMonthly: padMonthlySparkline(monthlyRows),
  };
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
