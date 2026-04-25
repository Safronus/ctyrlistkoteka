/**
 * Server-side find queries. Every function that returns find data MUST
 * run the result through `anonymize()` before returning to the caller —
 * see CLAUDE.md §6. Raw fields (`notes`, `coordinates`) never cross this
 * boundary unless already safe.
 */

import { FindState, Prisma, type ImageType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { anonymize } from "@/lib/anonymize";

export interface PublicImage {
  id: number;
  imageType: ImageType;
  webPath: string;
  thumbPath: string;
  width: number;
  height: number;
  isPrimary: boolean;
  sortOrder: number;
}

export interface PublicLocation {
  id: number;
  code: string;
  displayName: string;
  cadastralArea: string;
  /** May be null for codes without a TYPE segment (e.g. HOŠŤÁLKOVÁ001). */
  locationType: string | null;
}

export interface PublicFind {
  id: number;
  foundAt: Date | null;
  leafCount: number;
  notes: string | null; // nulled for anonymized
  isAnonymized: boolean;
  coordinates: { lat: number; lng: number } | null; // coarsened for anonymized
  location: PublicLocation | null;
  states: FindState[];
  images: PublicImage[];
  primaryImage: PublicImage | null;
}

export interface FindFilters {
  q?: string;
  locationId?: number;
  state?: FindState;
  leafCount?: number;
  year?: number;
}

export interface FindListResult {
  items: PublicFind[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Sort direction by find ID. `desc` = newest first (default UI). */
export type FindSort = "desc" | "asc";

/** Build the WHERE clause for a filter set. */
function buildWhere(f: FindFilters): Prisma.FindWhereInput {
  const where: Prisma.FindWhereInput = {};
  const and: Prisma.FindWhereInput[] = [];

  if (f.locationId) and.push({ locationId: f.locationId });
  if (f.leafCount) and.push({ leafCount: f.leafCount });
  if (f.state) and.push({ states: { some: { state: f.state } } });
  if (f.year) {
    const from = new Date(Date.UTC(f.year, 0, 1));
    const to = new Date(Date.UTC(f.year + 1, 0, 1));
    and.push({ foundAt: { gte: from, lt: to } });
  }

  if (f.q && f.q.trim()) {
    const q = f.q.trim();
    and.push({
      OR: [
        // Only search inside notes for NON-anonymized finds to avoid
        // leaking that a secret find matches a keyword.
        {
          AND: [
            { isAnonymized: false },
            { notes: { contains: q, mode: "insensitive" } },
          ],
        },
        { location: { displayName: { contains: q, mode: "insensitive" } } },
        { location: { code: { contains: q, mode: "insensitive" } } },
      ],
    });
  }

  if (and.length > 0) where.AND = and;
  return where;
}

/**
 * Finds are shipped to clients through this single pipe. Uses raw SQL for
 * PostGIS geometry; Prisma's `Unsupported` type gives us no accessor.
 */
async function hydrate(
  rows: Array<{
    id: number;
    foundAt: Date | null;
    leafCount: number;
    notes: string | null;
    isAnonymized: boolean;
    location: {
      id: number;
      code: string;
      displayName: string;
      cadastralArea: string;
      locationType: string | null;
    } | null;
    states: Array<{ state: FindState }>;
    images: Array<{
      id: number;
      imageType: ImageType;
      webPath: string;
      thumbPath: string;
      width: number;
      height: number;
      isPrimary: boolean;
      sortOrder: number;
    }>;
  }>,
): Promise<PublicFind[]> {
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const coordRows = await prisma.$queryRaw<
    Array<{ id: number; lat: number | null; lng: number | null }>
  >`
    SELECT id,
           ST_Y(coordinates)::float8 AS lat,
           ST_X(coordinates)::float8 AS lng
    FROM finds
    WHERE id IN (${Prisma.join(ids)}) AND coordinates IS NOT NULL
  `;
  const coordsMap = new Map<number, { lat: number; lng: number }>();
  for (const c of coordRows) {
    if (c.lat !== null && c.lng !== null) {
      coordsMap.set(c.id, { lat: c.lat, lng: c.lng });
    }
  }

  return rows.map((r) => {
    const images = [...r.images].sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.sortOrder - b.sortOrder;
    });
    const safe = anonymize({
      id: r.id,
      isAnonymized: r.isAnonymized,
      notes: r.notes,
      coordinates: coordsMap.get(r.id) ?? null,
    });
    return {
      id: r.id,
      foundAt: r.foundAt,
      leafCount: r.leafCount,
      notes: safe.notes,
      isAnonymized: r.isAnonymized,
      coordinates: safe.coordinates,
      location: r.location,
      states: r.states.map((s) => s.state),
      images,
      primaryImage: images[0] ?? null,
    };
  });
}

const LIST_INCLUDE = {
  location: {
    select: {
      id: true,
      code: true,
      displayName: true,
      cadastralArea: true,
      locationType: true,
    },
  },
  states: { select: { state: true } },
  images: {
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
} satisfies Prisma.FindInclude;

export async function listFinds(
  filters: FindFilters,
  page: number,
  pageSize: number,
  sort: FindSort = "desc",
): Promise<FindListResult> {
  const where = buildWhere(filters);
  const safePage = Math.max(1, page);
  const [total, rows] = await Promise.all([
    prisma.find.count({ where }),
    prisma.find.findMany({
      where,
      include: LIST_INCLUDE,
      orderBy: { id: sort },
      take: pageSize,
      skip: (safePage - 1) * pageSize,
    }),
  ]);
  const items = await hydrate(rows);
  return {
    items,
    total,
    page: safePage,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getFindById(id: number): Promise<PublicFind | null> {
  const row = await prisma.find.findUnique({
    where: { id },
    include: LIST_INCLUDE,
  });
  if (!row) return null;
  const [hydrated] = await hydrate([row]);
  return hydrated ?? null;
}

/** IDs of all known finds — used by generateStaticParams for the detail page. */
export async function getAllFindIds(): Promise<number[]> {
  const rows = await prisma.find.findMany({ select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * IDs of finds that are safe to index in the public sitemap. Anonymized
 * finds are excluded because CLAUDE.md §6 forbids them from appearing in
 * any search-engine surface. Returns lastModified so the sitemap can hint
 * at freshness to crawlers.
 */
export async function getIndexableFinds(): Promise<
  Array<{ id: number; updatedAt: Date }>
> {
  return prisma.find.findMany({
    where: { isAnonymized: false },
    select: { id: true, updatedAt: true },
    orderBy: { id: "asc" },
  });
}

/** Options for the /sbirka filter bar. Cached aggregations. */
export interface FilterOptions {
  locations: Array<{ id: number; label: string }>;
  states: FindState[];
  leafCounts: number[];
  years: number[];
}

export async function getFilterOptions(): Promise<FilterOptions> {
  const [locations, leafCountRows, yearRows] = await Promise.all([
    prisma.location.findMany({
      select: { id: true, code: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
    prisma.find.findMany({
      distinct: ["leafCount"],
      select: { leafCount: true },
      orderBy: { leafCount: "asc" },
    }),
    prisma.$queryRaw<Array<{ year: number }>>`
      SELECT DISTINCT EXTRACT(YEAR FROM found_at)::int AS year
      FROM finds
      WHERE found_at IS NOT NULL
      ORDER BY year DESC
    `,
  ]);

  return {
    locations: locations.map((l) => ({
      id: l.id,
      label: l.displayName || l.code,
    })),
    states: Object.values(FindState),
    leafCounts: leafCountRows.map((r) => r.leafCount),
    years: yearRows.map((r) => r.year),
  };
}

/** Simple totals for the home page. */
export async function getCollectionTotals(): Promise<{
  finds: number;
  locations: number;
  yearsSpan: number | null;
}> {
  const [finds, locations, yearSpanRow] = await Promise.all([
    prisma.find.count(),
    prisma.location.count(),
    prisma.$queryRaw<Array<{ min_y: number | null; max_y: number | null }>>`
      SELECT EXTRACT(YEAR FROM MIN(found_at))::int AS min_y,
             EXTRACT(YEAR FROM MAX(found_at))::int AS max_y
      FROM finds
    `,
  ]);
  const row = yearSpanRow[0];
  const yearsSpan =
    row && row.min_y !== null && row.max_y !== null
      ? row.max_y - row.min_y + 1
      : null;
  return { finds, locations, yearsSpan };
}
