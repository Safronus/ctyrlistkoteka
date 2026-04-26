/**
 * Server-side find queries. Every function that returns find data MUST
 * run the result through `anonymize()` before returning to the caller —
 * see CLAUDE.md §6. Raw fields (`notes`, `coordinates`) never cross this
 * boundary unless already safe.
 */

import { FindState, Prisma, type ImageType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { anonymize } from "@/lib/anonymize";
import { DEFAULT_LOCATION_ID } from "@/lib/constants";
import { parseIdQuery } from "@/lib/search";

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
  notes: string | null; // nulled for anonymized
  isAnonymized: boolean;
  coordinates: { lat: number; lng: number } | null; // coarsened for anonymized
  location: PublicLocation | null;
  states: FindState[];
  images: PublicImage[];
  primaryImage: PublicImage | null;
  /** First non-anonymized location map URL — used as a thumbnail in list
   *  rows. `null` when the find has no location, the location has no
   *  available maps, or the find itself is anonymized. */
  locationThumbUrl: string | null;
  /** Great-circle distance in metres from the default LocationMap
   *  (id = DEFAULT_LOCATION_ID). Null when the find is anonymized,
   *  has no GPS, or MAP 00001 isn't on disk. We deliberately set it
   *  to null for anonymized finds so the value can't be used to
   *  triangulate their position. */
  distanceFromDefault: number | null;
}

export interface FindFilters {
  q?: string;
  locationId?: number;
  state?: FindState;
  year?: number;
}

export interface FindListResult {
  items: PublicFind[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Sort direction. `desc`/`asc` order by find ID; `dist-asc`/`dist-desc`
 *  order by great-circle distance from MAP 00001 (closest / farthest
 *  first). Anonymized finds and finds without GPS get NULL distance and
 *  fall to the end of distance sorts regardless of direction. */
export type FindSort = "desc" | "asc" | "dist-asc" | "dist-desc";

/** Build the WHERE clause for a filter set. Async because numeric search
 *  queries trigger a small auxiliary lookup so that "0001" matches #00001
 *  (and the substring "0001" also matches #00010-#00019, #10010, etc.). */
async function buildWhere(f: FindFilters): Promise<Prisma.FindWhereInput> {
  const where: Prisma.FindWhereInput = {};
  const and: Prisma.FindWhereInput[] = [];

  if (f.locationId) {
    // When the requested location is a parent (has children declared via
    // data/meta/LokaceHierarchie.json), include every direct child in the
    // filter so the parent's "Vše ve sbírce" link surfaces every find
    // across the group. Max depth is 2 (enforced in sync.ts), so a single
    // findMany covers all descendants. For leaf locations this returns
    // an empty child set and the WHERE collapses to plain equality.
    const childRows = await prisma.location.findMany({
      where: { parentId: f.locationId },
      select: { id: true },
    });
    if (childRows.length === 0) {
      and.push({ locationId: f.locationId });
    } else {
      const ids = [f.locationId, ...childRows.map((r) => r.id)];
      and.push({ locationId: { in: ids } });
    }
  }
  if (f.state) and.push({ states: { some: { state: f.state } } });
  if (f.year) {
    const from = new Date(Date.UTC(f.year, 0, 1));
    const to = new Date(Date.UTC(f.year + 1, 0, 1));
    and.push({ foundAt: { gte: from, lt: to } });
  }

  if (f.q && f.q.trim()) {
    const q = f.q.trim();
    const or: Prisma.FindWhereInput[] = [
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
    ];

    // Numeric query → also match by find ID (exact + padded substring)
    // and by location ID. Padded substring uses a single raw query
    // against `LPAD(id::text, 5, '0')` so the lookup stays index-free
    // but cheap enough for ~17k finds.
    const idQuery = parseIdQuery(q);
    if (idQuery !== null) {
      or.push({ id: idQuery.exactId });
      or.push({ locationId: idQuery.exactId });
      const pattern = `%${idQuery.digits}%`;
      const idRows = await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM finds
        WHERE LPAD(id::text, 5, '0') LIKE ${pattern}
        LIMIT 1000
      `;
      if (idRows.length > 0) {
        or.push({ id: { in: idRows.map((r) => r.id) } });
      }
      const locRows = await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM locations
        WHERE LPAD(id::text, 5, '0') LIKE ${pattern}
      `;
      if (locRows.length > 0) {
        or.push({ locationId: { in: locRows.map((r) => r.id) } });
      }
    }

    and.push({ OR: or });
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
    Array<{
      id: number;
      lat: number | null;
      lng: number | null;
      dist_m: number | null;
    }>
  >`
    WITH ref AS (
      SELECT ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326) AS pt
      FROM location_maps WHERE id = ${DEFAULT_LOCATION_ID}
    )
    SELECT id,
           ST_Y(coordinates)::float8 AS lat,
           ST_X(coordinates)::float8 AS lng,
           CASE WHEN is_anonymized = false
                  AND (SELECT pt FROM ref) IS NOT NULL
                THEN ST_DistanceSphere(coordinates, (SELECT pt FROM ref))::float8
           END AS dist_m
    FROM finds
    WHERE id IN (${Prisma.join(ids)}) AND coordinates IS NOT NULL
  `;
  const coordsMap = new Map<number, { lat: number; lng: number }>();
  const distMap = new Map<number, number>();
  for (const c of coordRows) {
    if (c.lat !== null && c.lng !== null) {
      coordsMap.set(c.id, { lat: c.lat, lng: c.lng });
    }
    if (c.dist_m !== null) {
      distMap.set(c.id, c.dist_m);
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
      notes: safe.notes,
      isAnonymized: r.isAnonymized,
      coordinates: safe.coordinates,
      location: r.location,
      states: r.states.map((s) => s.state),
      images,
      primaryImage: images[0] ?? null,
      // Filled in by listFinds via a single bulk LocationMap query — see
      // attachLocationThumbs. Keeping it on the base shape avoids a second
      // PublicFind type just for list rows.
      locationThumbUrl: null as string | null,
      // SQL CASE already returns NULL for anonymized rows, so we never
      // surface a distance that could be used to back-derive the
      // anonymized find's position.
      distanceFromDefault: distMap.get(r.id) ?? null,
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
  const where = await buildWhere(filters);
  const safePage = Math.max(1, page);

  if (sort === "dist-asc" || sort === "dist-desc") {
    return listFindsByDistance(where, safePage, pageSize, sort);
  }

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
  await attachLocationThumbs(items);
  return {
    items,
    total,
    page: safePage,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Distance-sorted listing path. Prisma can't ORDER BY a PostGIS-derived
 * scalar through its WhereInput-driven query builder, so we:
 *   1) ask Prisma for every matching find ID under the user's filters,
 *   2) batch-pull each ID's distance + anonymization flag via raw SQL,
 *   3) sort + paginate the IDs in JS (anonymized / no-GPS rows fall to
 *      the end regardless of direction so distance order can't be used
 *      to triangulate them),
 *   4) hand the page slice back to Prisma to fetch full include rows.
 *
 * For the current dataset (~17 k finds) the extra round-trip is sub-100 ms;
 * we'll revisit if the catalog grows past ~100 k.
 */
async function listFindsByDistance(
  where: Prisma.FindWhereInput,
  safePage: number,
  pageSize: number,
  sort: "dist-asc" | "dist-desc",
): Promise<FindListResult> {
  const idRows = await prisma.find.findMany({
    where,
    select: { id: true },
  });
  const ids = idRows.map((r) => r.id);
  const total = ids.length;
  if (total === 0) {
    return {
      items: [],
      total: 0,
      page: safePage,
      pageSize,
      totalPages: 1,
    };
  }

  // Anonymized rows get NULL distance so they can't be ordered by it —
  // mirrors the policy in hydrate().
  const distRows = await prisma.$queryRaw<
    Array<{ id: number; dist_m: number | null }>
  >`
    WITH ref AS (
      SELECT ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326) AS pt
      FROM location_maps WHERE id = ${DEFAULT_LOCATION_ID}
    )
    SELECT id,
           CASE WHEN is_anonymized = false
                  AND coordinates IS NOT NULL
                  AND (SELECT pt FROM ref) IS NOT NULL
                THEN ST_DistanceSphere(coordinates, (SELECT pt FROM ref))::float8
           END AS dist_m
    FROM finds
    WHERE id IN (${Prisma.join(ids)})
  `;
  const distMap = new Map<number, number | null>();
  for (const r of distRows) distMap.set(r.id, r.dist_m);

  const dir = sort === "dist-asc" ? 1 : -1;
  const sortedIds = [...ids].sort((a, b) => {
    const da = distMap.get(a) ?? null;
    const db = distMap.get(b) ?? null;
    if (da === null && db === null) return a - b; // stable by id
    if (da === null) return 1; // a after b
    if (db === null) return -1; // a before b
    return dir * (da - db);
  });

  const pageIds = sortedIds.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );
  if (pageIds.length === 0) {
    return {
      items: [],
      total,
      page: safePage,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  const pageRows = await prisma.find.findMany({
    where: { id: { in: pageIds } },
    include: LIST_INCLUDE,
  });
  // Prisma returns rows in arbitrary order — re-sort to match the
  // distance-driven page order so the UI sees the right sequence.
  const byId = new Map(pageRows.map((r) => [r.id, r]));
  const ordered = pageIds
    .map((id) => byId.get(id))
    .filter((r): r is (typeof pageRows)[number] => r !== undefined);
  const items = await hydrate(ordered);
  await attachLocationThumbs(items);
  return {
    items,
    total,
    page: safePage,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * In-place: fills `locationThumbUrl` on each find with the URL of the
 * first non-anonymized location map for that find's location. Done in a
 * single bulk query against location_maps so the page render stays at
 * one extra round-trip regardless of page size. Anonymized finds never
 * receive a thumb — disclosing the location's map would defeat the
 * point of anonymization.
 */
async function attachLocationThumbs(finds: PublicFind[]): Promise<void> {
  const locationIds = [
    ...new Set(
      finds
        .filter((f) => !f.isAnonymized && f.location)
        .map((f) => f.location!.id),
    ),
  ];
  if (locationIds.length === 0) return;

  const maps = await prisma.locationMap.findMany({
    where: { locationId: { in: locationIds }, isAnonymized: false },
    select: { locationId: true, imagePath: true },
    orderBy: [{ locationId: "asc" }, { id: "asc" }],
  });
  const firstByLoc = new Map<number, string>();
  for (const m of maps) {
    if (!firstByLoc.has(m.locationId)) {
      firstByLoc.set(m.locationId, m.imagePath);
    }
  }
  for (const f of finds) {
    if (f.isAnonymized || !f.location) continue;
    f.locationThumbUrl = firstByLoc.get(f.location.id) ?? null;
  }
}

export interface PublicLocationMap {
  id: number;
  imageUrl: string;
  imageWidth: number | null;
  imageHeight: number | null;
  description: string | null;
}

export interface PublicFindDetail extends PublicFind {
  locationMaps: PublicLocationMap[];
}

export async function getFindById(
  id: number,
): Promise<PublicFindDetail | null> {
  const row = await prisma.find.findUnique({
    where: { id },
    include: LIST_INCLUDE,
  });
  if (!row) return null;
  const [hydrated] = await hydrate([row]);
  if (!hydrated) return null;

  // Anonymized finds: load the default placeholder location *in full*
  // (id, code, displayName, maps) and substitute it for the real one so
  // nothing about the actual location — not even its numeric id — leaks
  // out of the query layer. The page can render the panel exactly the
  // same way it does for any other find; the anonymized banner explains
  // the substitution.
  if (hydrated.isAnonymized) {
    const placeholder = await fetchPublicLocation(DEFAULT_LOCATION_ID);
    const placeholderMaps = await fetchLocationMaps(DEFAULT_LOCATION_ID);
    return {
      ...hydrated,
      location: placeholder,
      locationMaps: placeholderMaps,
    };
  }

  // Non-anonymized: show whatever maps we have for this location.
  const locationMaps = hydrated.location
    ? await fetchLocationMaps(hydrated.location.id)
    : [];
  return { ...hydrated, locationMaps };
}

async function fetchPublicLocation(
  locationId: number,
): Promise<PublicLocation | null> {
  const row = await prisma.location.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      code: true,
      displayName: true,
      cadastralArea: true,
      locationType: true,
    },
  });
  return row ?? null;
}

async function fetchLocationMaps(
  locationId: number,
): Promise<PublicLocationMap[]> {
  const maps = await prisma.locationMap.findMany({
    where: { locationId, isAnonymized: false },
    select: {
      id: true,
      imagePath: true,
      imageWidth: true,
      imageHeight: true,
      description: true,
    },
    orderBy: { id: "asc" },
  });
  return maps.map((m) => ({
    id: m.id,
    imageUrl: m.imagePath,
    imageWidth: m.imageWidth,
    imageHeight: m.imageHeight,
    description: m.description,
  }));
}

/** IDs of all known finds — used by generateStaticParams for the detail page. */
export async function getAllFindIds(): Promise<number[]> {
  const rows = await prisma.find.findMany({ select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Returns the next/previous find IDs in numeric order around `currentId`.
 * Skips holes — if the user's IDs are 12, 14, 17, then prev(14) = 12
 * and next(14) = 17. Either side returns null at the ends of the range.
 */
export async function getAdjacentFindIds(
  currentId: number,
): Promise<{ prevId: number | null; nextId: number | null }> {
  const [prev, next] = await Promise.all([
    prisma.find.findFirst({
      where: { id: { lt: currentId } },
      orderBy: { id: "desc" },
      select: { id: true },
    }),
    prisma.find.findFirst({
      where: { id: { gt: currentId } },
      orderBy: { id: "asc" },
      select: { id: true },
    }),
  ]);
  return {
    prevId: prev?.id ?? null,
    nextId: next?.id ?? null,
  };
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
  years: number[];
}

export async function getFilterOptions(): Promise<FilterOptions> {
  const [locations, yearRows] = await Promise.all([
    prisma.location.findMany({
      select: { id: true, code: true, displayName: true },
      orderBy: { displayName: "asc" },
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
    years: yearRows.map((r) => r.year),
  };
}

/** Simple totals for the home page. */
export interface CollectionProgress {
  count: number;
  minFindId: number | null;
  maxFindId: number | null;
}

/**
 * Range + count of find IDs currently in the DB. Used by /sbirka to flag
 * a back-catalog import that hasn't reached find #1 yet (or that has
 * gaps within its current range). Cheap — one count + a min/max query.
 */
export async function getCollectionProgress(): Promise<CollectionProgress> {
  const [count, range] = await Promise.all([
    prisma.find.count(),
    prisma.$queryRaw<Array<{ min_id: number | null; max_id: number | null }>>`
      SELECT MIN(id)::int AS min_id, MAX(id)::int AS max_id FROM finds
    `,
  ]);
  const r = range[0];
  if (count === 0 || !r || r.min_id === null || r.max_id === null) {
    return { count, minFindId: null, maxFindId: null };
  }
  return { count, minFindId: r.min_id, maxFindId: r.max_id };
}

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
