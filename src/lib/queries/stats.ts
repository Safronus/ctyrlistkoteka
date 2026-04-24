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
  averageLeaves: number;
  firstYear: number | null;
  lastYear: number | null;
  maxLeaves: number | null;
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

export interface CollectionStats {
  totals: StatsTotals;
  monthly: MonthlyPoint[];
  yearly: YearlyPoint[];
  topLocations: LocationPoint[];
  leafDistribution: CategoryPoint[];
  locationTypes: CategoryPoint[];
  states: CategoryPoint[];
}

export async function getCollectionStats(): Promise<CollectionStats> {
  const [
    totalsRow,
    monthlyRows,
    yearlyRows,
    topLocRows,
    leafRows,
    typeRows,
    stateRows,
  ] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        finds: bigint;
        locations: bigint;
        photographed: bigint;
        anonymized: bigint;
        avg_leaves: number | null;
        first_year: number | null;
        last_year: number | null;
        max_leaves: number | null;
      }>
    >`
      SELECT
        (SELECT COUNT(*) FROM finds) AS finds,
        (SELECT COUNT(*) FROM locations) AS locations,
        (SELECT COUNT(DISTINCT find_id) FROM find_images) AS photographed,
        (SELECT COUNT(*) FROM finds WHERE is_anonymized = true) AS anonymized,
        (SELECT AVG(leaf_count)::float8 FROM finds) AS avg_leaves,
        (SELECT EXTRACT(YEAR FROM MIN(found_at))::int FROM finds) AS first_year,
        (SELECT EXTRACT(YEAR FROM MAX(found_at))::int FROM finds) AS last_year,
        (SELECT MAX(leaf_count) FROM finds) AS max_leaves
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

    prisma.$queryRaw<Array<{ leaf_count: number; count: bigint }>>`
      SELECT leaf_count, COUNT(*) AS count
      FROM finds
      GROUP BY 1 ORDER BY 1
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
    averageLeaves: t?.avg_leaves
      ? Math.round(t.avg_leaves * 100) / 100
      : 0,
    firstYear: t?.first_year ?? null,
    lastYear: t?.last_year ?? null,
    maxLeaves: t?.max_leaves ?? null,
  };

  return {
    totals,
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
    leafDistribution: leafRows.map((r) => ({
      name: `${r.leaf_count} lístků`,
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
