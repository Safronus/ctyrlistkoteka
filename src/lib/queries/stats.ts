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
  name: string;
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
  ] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        finds: bigint;
        locations: bigint;
        photographed: bigint;
        anonymized: bigint;
        first_year: number | null;
        last_year: number | null;
      }>
    >`
      SELECT
        (SELECT COUNT(*) FROM finds) AS finds,
        (SELECT COUNT(*) FROM locations) AS locations,
        (SELECT COUNT(DISTINCT find_id) FROM find_images) AS photographed,
        (SELECT COUNT(*) FROM finds WHERE is_anonymized = true) AS anonymized,
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

    prisma.$queryRaw<
      Array<{ id: number; name: string; count: bigint }>
    >`
      SELECT l.id,
             COALESCE(NULLIF(l.display_name, ''), l.code) AS name,
             COUNT(f.id) AS count
      FROM locations l
      LEFT JOIN finds f ON f.location_id = l.id
      GROUP BY l.id, l.display_name, l.code
      ORDER BY count DESC, l.id
      LIMIT 15
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
  ]);

  const t = totalsRow[0];
  const totals: StatsTotals = {
    finds: t ? Number(t.finds) : 0,
    locations: t ? Number(t.locations) : 0,
    photographed: t ? Number(t.photographed) : 0,
    anonymized: t ? Number(t.anonymized) : 0,
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
  };
}
