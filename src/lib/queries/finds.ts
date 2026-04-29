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
import { countryFromCoords } from "@/lib/geo";
import { listCadastralAreas, listCountries } from "@/lib/queries/locations";
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
  /** Offset of the find's GPS from its own location. When the location
   *  has a polygon, this is the great-circle distance to the nearest
   *  polygon edge — 0 when the point is inside the AOI, positive when
   *  outside. When the location has only a center point (no polygon),
   *  it falls back to the great-circle distance from that center. The
   *  `mode` lets the UI pick the right wording so visitors don't read
   *  "120 m from center" as a misplacement bug.
   *
   *  Null when the find is anonymized, has no GPS, or its location has
   *  neither a polygon nor a center point. */
  locationOffset: {
    meters: number;
    mode: "polygon" | "center";
  } | null;
}

export interface FindFilters {
  q?: string;
  locationId?: number;
  /** Cadastral area name as it appears in `locations.cadastral_area`.
   *  Filters finds whose location is registered in that municipality. */
  cadastralArea?: string;
  /** ISO 3166-1 numeric code (string) — same key used by /lokality and
   *  the choropleth on /statistiky. Filters finds whose location's
   *  center point falls inside that country's polygon. */
  country?: string;
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
  if (f.cadastralArea) {
    and.push({ location: { cadastralArea: f.cadastralArea } });
  }
  if (f.country) {
    // Country lookup runs against the location's center point — same
    // resolver /statistiky and /lokality use, so the dropdown options
    // and outcomes stay in sync. We pre-resolve the matching location
    // IDs here so the WHERE stays a plain `locationId IN (…)` and
    // doesn't drag PostGIS into the find query.
    const ids = await locationIdsInCountry(f.country);
    if (ids.length === 0) {
      // No locations match this country — short-circuit to an empty set.
      // `id: -1` is impossible (find IDs are positive integers from the
      // user's filename numbering), so the AND collapses to false.
      and.push({ id: -1 });
    } else {
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
      loc_offset_m: number | null;
      loc_offset_mode: "polygon" | "center" | null;
    }>
  >`
    WITH ref AS (
      SELECT ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326) AS pt
      FROM location_maps WHERE id = ${DEFAULT_LOCATION_ID}
    )
    SELECT f.id,
           ST_Y(f.coordinates)::float8 AS lat,
           ST_X(f.coordinates)::float8 AS lng,
           CASE WHEN f.is_anonymized = false
                  AND (SELECT pt FROM ref) IS NOT NULL
                THEN ST_DistanceSphere(f.coordinates, (SELECT pt FROM ref))::float8
           END AS dist_m,
           CASE WHEN f.is_anonymized = false THEN
                CASE
                  WHEN l.polygon IS NOT NULL
                    THEN ST_Distance(f.coordinates::geography, l.polygon::geography)::float8
                  WHEN l.center_point IS NOT NULL
                    THEN ST_DistanceSphere(f.coordinates, l.center_point)::float8
                  ELSE NULL
                END
           END AS loc_offset_m,
           CASE WHEN f.is_anonymized = false THEN
                CASE
                  WHEN l.polygon IS NOT NULL THEN 'polygon'
                  WHEN l.center_point IS NOT NULL THEN 'center'
                  ELSE NULL
                END
           END AS loc_offset_mode
    FROM finds f
    LEFT JOIN locations l ON l.id = f.location_id
    WHERE f.id IN (${Prisma.join(ids)}) AND f.coordinates IS NOT NULL
  `;
  const coordsMap = new Map<number, { lat: number; lng: number }>();
  const distMap = new Map<number, number>();
  const offsetMap = new Map<
    number,
    { meters: number; mode: "polygon" | "center" }
  >();
  for (const c of coordRows) {
    if (c.lat !== null && c.lng !== null) {
      coordsMap.set(c.id, { lat: c.lat, lng: c.lng });
    }
    if (c.dist_m !== null) {
      distMap.set(c.id, c.dist_m);
    }
    if (c.loc_offset_m !== null && c.loc_offset_mode !== null) {
      offsetMap.set(c.id, {
        meters: c.loc_offset_m,
        mode: c.loc_offset_mode,
      });
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
      locationOffset: offsetMap.get(r.id) ?? null,
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
  /** Where to draw the find's GPS marker on top of this map.
   *  - `inside` → render the icon at (xFrac, yFrac) in image coordinates
   *  - `outside` → the find's GPS falls beyond the map's recorded bounds,
   *     show a one-line note instead of a marker
   *  - `no-gps` → the find has no GPS recorded — note instead of marker
   *  - `null`  → marker logic doesn't apply (anonymized find, or the
   *     map row predates `imageBounds` and we can't place the pin) */
  marker:
    | { kind: "inside"; xFrac: number; yFrac: number }
    | { kind: "outside" }
    | { kind: "no-gps" }
    | null;
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
    // Pass `null` coordinates so no marker is computed — anonymized
    // finds never expose a position, even on the placeholder map.
    const placeholderMaps = await fetchLocationMaps(DEFAULT_LOCATION_ID, null);
    return {
      ...hydrated,
      location: placeholder,
      locationMaps: placeholderMaps,
    };
  }

  // Non-anonymized: show whatever maps we have for this location.
  const locationMaps = hydrated.location
    ? await fetchLocationMaps(hydrated.location.id, hydrated.coordinates)
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
  /** Find's GPS for marker placement. `null` skips the calculation:
   *  - the find has no GPS, OR
   *  - we're loading the placeholder map for an anonymized find (the
   *    caller is responsible for not passing real coordinates here). */
  coordinates: { lat: number; lng: number } | null,
): Promise<PublicLocationMap[]> {
  const maps = await prisma.locationMap.findMany({
    where: { locationId, isAnonymized: false },
    select: {
      id: true,
      imagePath: true,
      imageWidth: true,
      imageHeight: true,
      description: true,
      imageBounds: true,
    },
    orderBy: { id: "asc" },
  });
  return maps.map((m) => ({
    id: m.id,
    imageUrl: m.imagePath,
    imageWidth: m.imageWidth,
    imageHeight: m.imageHeight,
    description: m.description,
    marker: computeMarker(coordinates, m.imageBounds),
  }));
}

/** Linear interpolation of (lat, lng) into the map's image rectangle.
 *  `imageBounds` is `[[swLat, swLng], [neLat, neLng]]` per
 *  `computeMapBounds()` in src/lib/images.ts. The math is equirectangular,
 *  matching the way the bounds were produced — sub-pixel error at sub-km
 *  map sizes (Web Mercator nonlinearity is negligible there). */
function computeMarker(
  coordinates: { lat: number; lng: number } | null,
  imageBounds: unknown,
): PublicLocationMap["marker"] {
  if (coordinates === null) return { kind: "no-gps" };
  if (!Array.isArray(imageBounds) || imageBounds.length !== 2) return null;
  const [sw, ne] = imageBounds as [unknown, unknown];
  if (
    !Array.isArray(sw) ||
    sw.length !== 2 ||
    !Array.isArray(ne) ||
    ne.length !== 2
  ) {
    return null;
  }
  const swLat = Number(sw[0]);
  const swLng = Number(sw[1]);
  const neLat = Number(ne[0]);
  const neLng = Number(ne[1]);
  if (
    !Number.isFinite(swLat) ||
    !Number.isFinite(swLng) ||
    !Number.isFinite(neLat) ||
    !Number.isFinite(neLng) ||
    neLat === swLat ||
    neLng === swLng
  ) {
    return null;
  }
  const xFrac = (coordinates.lng - swLng) / (neLng - swLng);
  // Lat grows northward but image y grows downward — flip.
  const yFrac = 1 - (coordinates.lat - swLat) / (neLat - swLat);
  // Inclusive boundary check: a find sitting exactly on the edge counts
  // as inside (renders with the pin tip on the edge), not as outside.
  if (xFrac < 0 || xFrac > 1 || yFrac < 0 || yFrac > 1) {
    return { kind: "outside" };
  }
  return { kind: "inside", xFrac, yFrac };
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

/** Returns the find IDs that match the given filters. Used by the /mapa
 *  page when the visitor arrives with /sbirka filter params attached —
 *  the resulting set drives the canvas dim so only matching finds stay
 *  bright. Reuses `buildWhere` so the predicate matches /sbirka exactly
 *  (including country point-in-polygon, location parent/children fold,
 *  notes search, …).
 *
 *  We don't filter out finds without GPS or anonymized rows here: those
 *  finds aren't in `findCoords` to begin with, so a stray ID in the set
 *  is harmless — the canvas iterates findCoords, not the set. */
export async function getFilteredFindIds(
  filters: FindFilters,
): Promise<number[]> {
  const where = await buildWhere(filters);
  const rows = await prisma.find.findMany({
    where,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Slim payload used by /mapa's `?find=N` deep-link to highlight a single
 *  find. Anonymized finds intentionally resolve to `null` — their coords
 *  are coarsened or hidden, so pinning them precisely on the map would
 *  defeat the anonymization. */
export interface HighlightFind {
  id: number;
  lat: number;
  lng: number;
  locationId: number | null;
  offset: { meters: number; mode: "polygon" | "center" } | null;
}

export async function getHighlightFind(
  id: number,
): Promise<HighlightFind | null> {
  const row = await prisma.find.findUnique({
    where: { id },
    select: { id: true, isAnonymized: true, locationId: true },
  });
  if (!row || row.isAnonymized) return null;

  const coordRows = await prisma.$queryRaw<
    Array<{
      lat: number | null;
      lng: number | null;
      loc_offset_m: number | null;
      loc_offset_mode: "polygon" | "center" | null;
    }>
  >`
    SELECT ST_Y(f.coordinates)::float8 AS lat,
           ST_X(f.coordinates)::float8 AS lng,
           CASE
             WHEN l.polygon IS NOT NULL
               THEN ST_Distance(f.coordinates::geography, l.polygon::geography)::float8
             WHEN l.center_point IS NOT NULL
               THEN ST_DistanceSphere(f.coordinates, l.center_point)::float8
             ELSE NULL
           END AS loc_offset_m,
           CASE
             WHEN l.polygon IS NOT NULL THEN 'polygon'
             WHEN l.center_point IS NOT NULL THEN 'center'
             ELSE NULL
           END AS loc_offset_mode
    FROM finds f
    LEFT JOIN locations l ON l.id = f.location_id
    WHERE f.id = ${id} AND f.coordinates IS NOT NULL
  `;
  const c = coordRows[0];
  if (!c || c.lat === null || c.lng === null) return null;

  return {
    id: row.id,
    lat: c.lat,
    lng: c.lng,
    locationId: row.locationId,
    offset:
      c.loc_offset_m !== null && c.loc_offset_mode !== null
        ? { meters: c.loc_offset_m, mode: c.loc_offset_mode }
        : null,
  };
}

/** Returns location IDs whose center point falls inside the given
 *  country's polygon. Used by `buildWhere` to express `country = X` as
 *  a plain `locationId IN (…)` condition without dragging PostGIS into
 *  the main find query. The locations table is small (~128 rows), so
 *  this scan is cheap. */
async function locationIdsInCountry(country: string): Promise<number[]> {
  const rows = await prisma.$queryRaw<
    Array<{ id: number; lat: number; lng: number }>
  >`
    SELECT id,
           ST_Y(center_point)::float8 AS lat,
           ST_X(center_point)::float8 AS lng
    FROM "locations"
    WHERE center_point IS NOT NULL
  `;
  return rows
    .filter((r) => countryFromCoords(r.lat, r.lng).code === country)
    .map((r) => r.id);
}

/** Options for the /sbirka filter bar. Cached aggregations. */
export interface FilterOptions {
  locations: Array<{ id: number; label: string }>;
  cities: string[];
  countries: Array<{ code: string; name: string }>;
  states: FindState[];
  years: number[];
}

export async function getFilterOptions(): Promise<FilterOptions> {
  const [locations, yearRows, cities, countries] = await Promise.all([
    prisma.location.findMany({
      select: { id: true, code: true, displayName: true },
      orderBy: { code: "asc" },
    }),
    prisma.$queryRaw<Array<{ year: number }>>`
      SELECT DISTINCT EXTRACT(YEAR FROM found_at)::int AS year
      FROM finds
      WHERE found_at IS NOT NULL
      ORDER BY year DESC
    `,
    listCadastralAreas(),
    listCountries(),
  ]);

  return {
    locations: locations.map((l) => ({
      id: l.id,
      // Code is the formal identifier; displayName is the human note. Show
      // both so visitors can recognize a location either way — the code
      // matches what they see on /lokality and on filenames, the
      // displayName describes the place.
      label:
        l.displayName && l.displayName.trim() && l.displayName !== l.code
          ? `${l.code} — ${l.displayName}`
          : l.code,
    })),
    cities,
    countries,
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
