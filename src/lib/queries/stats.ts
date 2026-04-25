/**
 * Aggregated collection statistics. All queries use SQL aggregates for
 * performance — at 17k rows we don't need materialized views yet, but the
 * shape is prepared for them (docs/data-schema.md).
 *
 * Anonymization note: these queries return *counts only*, no per-find data
 * or notes leave the server. Location names in `topLocations` are public
 * (shown on the map) so it's fine to list them.
 */

import { FindState } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface StatsTotals {
  finds: number;
  locations: number;
  photographed: number;
  anonymized: number;
  /** Distinct finds tagged with the DONATED state — i.e. clovers that
   *  the user gifted away. Reused on the page header to highlight the
   *  share of the collection that left the archive. */
  donatedFinds: number;
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

export interface CategoryPoint {
  name: string;
  count: number;
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

export interface CollectionStats {
  totals: StatsTotals;
  /** Earliest find by ID, or null if the collection is empty. */
  firstFind: FindHighlight | null;
  /** Latest find by ID, mirroring firstFind. */
  lastFind: FindHighlight | null;
  monthly: MonthlyPoint[];
  yearly: YearlyPoint[];
  topLocations: LocationPoint[];
  locationTypes: CategoryPoint[];
  states: CategoryPoint[];
  /** Hour of day (0..23). Includes only hours that have data. */
  byHour: CalendarPoint[];
  /** Day of week (1=Monday … 7=Sunday). Includes only DoWs with data. */
  byDayOfWeek: CalendarPoint[];
  /** Month of year (1=January … 12=December). Includes only months with data. */
  byMonthOfYear: CalendarPoint[];
  /** Month×day heatmap, year-independent. Sparse: only cells that
   *  have at least one find. */
  byMonthDay: MonthDayPoint[];
}

export async function getCollectionStats(): Promise<CollectionStats> {
  type HighlightRow = {
    id: number;
    found_at: Date | null;
    is_anonymized: boolean;
    location_id: number | null;
    location_code: string | null;
    location_display_name: string | null;
  };

  const [
    totalsRow,
    firstFindRow,
    lastFindRow,
    monthlyRows,
    yearlyRows,
    topLocRows,
    typeRows,
    stateRows,
    hourRows,
    dowRows,
    monthRows,
    monthDayRows,
  ] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        finds: bigint;
        locations: bigint;
        photographed: bigint;
        anonymized: bigint;
        donated_finds: bigint;
        anonymized_locations: bigint;
        gone_locations: bigint;
        first_year: number | null;
        last_year: number | null;
      }>
    >`
      SELECT
        (SELECT COUNT(*) FROM finds) AS finds,
        (SELECT COUNT(*) FROM locations) AS locations,
        (SELECT COUNT(DISTINCT find_id) FROM find_images) AS photographed,
        (SELECT COUNT(*) FROM finds WHERE is_anonymized = true) AS anonymized,
        (SELECT COUNT(DISTINCT find_id) FROM find_state_assignments
           WHERE state = 'DONATED') AS donated_finds,
        (SELECT COUNT(DISTINCT location_id) FROM location_maps
           WHERE is_anonymized = true) AS anonymized_locations,
        (SELECT COUNT(*) FROM locations
           WHERE code LIKE 'NEEXISTUJE-%') AS gone_locations,
        (SELECT EXTRACT(YEAR FROM MIN(found_at))::int FROM finds) AS first_year,
        (SELECT EXTRACT(YEAR FROM MAX(found_at))::int FROM finds) AS last_year
    `,

    // Earliest / latest find by ID (mirrors the user's MAP_ID
    // chronology). The CASE-anonymise pattern keeps location info
    // out of the payload for is_anonymized=true rows so we never
    // ship something that has to be re-redacted client-side.
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

    prisma.$queryRaw<Array<{ month: Date; count: bigint }>>`
      SELECT date_trunc('month', found_at)::date AS month, COUNT(*) AS count
      FROM finds WHERE found_at IS NOT NULL
      GROUP BY 1 ORDER BY 1
    `,

    prisma.$queryRaw<Array<{ year: number; count: bigint }>>`
      SELECT EXTRACT(YEAR FROM found_at)::int AS year, COUNT(*) AS count
      FROM finds WHERE found_at IS NOT NULL
      GROUP BY 1 ORDER BY 1
    `,

    // Top 10 locations by find count, dropping anonymized locations
    // (their code/name/findCount can't be exposed publicly per
    // CLAUDE.md §6).
    prisma.$queryRaw<
      Array<{ id: number; code: string; name: string; count: bigint }>
    >`
      SELECT l.id,
             l.code,
             COALESCE(NULLIF(l.display_name, ''), l.code) AS name,
             COUNT(f.id) AS count
      FROM locations l
      LEFT JOIN finds f ON f.location_id = l.id
      WHERE l.id NOT IN (
        SELECT DISTINCT location_id FROM location_maps WHERE is_anonymized = true
      )
      GROUP BY l.id, l.code, l.display_name
      ORDER BY count DESC, l.id
      LIMIT 10
    `,

    prisma.$queryRaw<Array<{ type: string; count: bigint }>>`
      SELECT l.location_type AS type, COUNT(f.id) AS count
      FROM locations l
      LEFT JOIN finds f ON f.location_id = l.id
      GROUP BY l.location_type
      ORDER BY count DESC
    `,

    prisma.$queryRaw<Array<{ state: FindState; count: bigint }>>`
      SELECT state, COUNT(DISTINCT find_id) AS count
      FROM find_state_assignments
      GROUP BY state
      ORDER BY count DESC
    `,

    // Calendar axes — ignore time zone offsets (use the find's local
    // wall-clock the user recorded). Anonymization-stripped foundAt
    // is fine because `is_anonymized` doesn't affect the timestamp.
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
    prisma.$queryRaw<
      Array<{ month: number; day: number; count: bigint }>
    >`
      SELECT EXTRACT(MONTH FROM found_at)::int AS month,
             EXTRACT(DAY FROM found_at)::int AS day,
             COUNT(*) AS count
      FROM finds WHERE found_at IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 1, 2
    `,
  ]);

  const t = totalsRow[0];
  const totals: StatsTotals = {
    finds: t ? Number(t.finds) : 0,
    locations: t ? Number(t.locations) : 0,
    photographed: t ? Number(t.photographed) : 0,
    anonymized: t ? Number(t.anonymized) : 0,
    donatedFinds: t ? Number(t.donated_finds) : 0,
    anonymizedLocations: t ? Number(t.anonymized_locations) : 0,
    goneLocations: t ? Number(t.gone_locations) : 0,
    firstYear: t?.first_year ?? null,
    lastYear: t?.last_year ?? null,
  };

  const highlight = (row: HighlightRow | undefined): FindHighlight | null => {
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
  };

  return {
    totals,
    firstFind: highlight(firstFindRow[0]),
    lastFind: highlight(lastFindRow[0]),
    monthly: monthlyRows.map((r) => ({
      month: r.month.toISOString().slice(0, 7),
      count: Number(r.count),
    })),
    yearly: yearlyRows.map((r) => ({
      year: r.year,
      count: Number(r.count),
    })),
    topLocations: topLocRows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      count: Number(r.count),
    })),
    locationTypes: typeRows.map((r) => ({
      name: r.type,
      count: Number(r.count),
    })),
    states: stateRows.map((r) => ({
      name: r.state,
      count: Number(r.count),
    })),
    byHour: hourRows.map((r) => ({ key: r.hour, count: Number(r.count) })),
    byDayOfWeek: dowRows.map((r) => ({ key: r.dow, count: Number(r.count) })),
    byMonthOfYear: monthRows.map((r) => ({
      key: r.month,
      count: Number(r.count),
    })),
    byMonthDay: monthDayRows.map((r) => ({
      month: r.month,
      day: r.day,
      count: Number(r.count),
    })),
  };
}
