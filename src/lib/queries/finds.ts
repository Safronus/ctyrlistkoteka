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
import {
  getFindIdsWithRealPhotos,
  getFindPhotos,
  type FindPhotoEntry,
} from "@/lib/findPhotos";
import {
  getFindFreePhotos,
  getFindIdsWithFreePhotos,
  type FindFreePhotoEntry,
} from "@/lib/findFreePhotos";
import { countryFromCoords } from "@/lib/geo";
import {
  cityFromCadastralArea,
  NEEXISTUJE_PREFIX,
} from "@/lib/locationCode";
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
  /** True when the find has at least one donation photo on disk under
   *  `${GENERATED_DIR}/find-photos/`. Drives the camera badge on the
   *  /sbirka list rows and the gallery button on the detail page. The
   *  flag itself is public for non-anonymized finds; anonymized finds
   *  collapse to `false` regardless so the indicator can't betray that
   *  hidden donations exist. ANON-suffixed photo files still register
   *  their parent find as having a photo (so the gallery button can
   *  show a placeholder + unlock UI). */
  hasRealPhoto: boolean;
  /** True when the find has at least one "free" photo on disk under
   *  `${GENERATED_DIR}/find-free-photos/`. Drives a secondary badge on
   *  the /sbirka list rows — independent from hasRealPhoto so the two
   *  galleries surface separately. Anonymized finds force false (same
   *  rationale as hasRealPhoto). */
  hasFreePhoto: boolean;
  /** Offset of the find's GPS from its own location. When the location
   *  has a polygon, `meters` is the great-circle distance to the nearest
   *  polygon edge — 0 when the point is inside the AOI, positive when
   *  outside — and `inside` is true iff the point is contained by (or
   *  exactly on) the polygon (via PostGIS ST_Covers). When the location
   *  has only a center point (no polygon), `meters` falls back to the
   *  great-circle distance from that center and `inside` is always
   *  false. The `mode` lets the UI pick the right wording so visitors
   *  don't read "120 m from center" as a misplacement bug.
   *
   *  We separate `inside` from `meters < 1` because ST_Distance can
   *  legitimately return sub-metre POSITIVE values for points that are
   *  actually outside the AOI but very close to its edge — collapsing
   *  those to "uvnitř AOI" misleads visitors (real bug report).
   *
   *  Null when the find is anonymized, has no GPS, or its location has
   *  neither a polygon nor a center point. */
  locationOffset: {
    meters: number;
    mode: "polygon" | "center";
    inside: boolean;
    /** True when the find's GPS falls inside the bounding box of at
     *  least one of its location's `location_maps`. Drives the
     *  yellow-vs-red split in `locationOffsetToneClass` and
     *  `classifyMapStatus`: not-green + within-map = yellow,
     *  not-green + outside-all-maps = red. Always false when the
     *  location has no usable map bbox. */
    withinMap: boolean;
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
  /** Inclusive lower bound on `foundAt`. Day-resolution; the parser
   *  pins this to UTC midnight. */
  dateFrom?: Date;
  /** Inclusive upper bound on `foundAt`. Day-resolution; the WHERE
   *  builder converts this to "< next-day-UTC-midnight" so the whole
   *  selected day counts. */
  dateTo?: Date;
  /** When true, keep only finds that have at least one donation photo
   *  on disk. Wired to the "S reálnou fotkou" toggle in the FilterBar.
   *  Applied as a post-filter against the on-disk index because
   *  `find-photos/` is filesystem-only — no DB column to query. */
  hasRealPhoto?: boolean;
  /** When set, REMOVE finds whose location id is this value or whose
   *  location is a direct child of it (parent/child hierarchy from
   *  data/meta/LokaceHierarchie.json). Mirrors the inclusion behaviour
   *  of `locationId` so the same parent→children traversal applies in
   *  reverse. Wired to the "Skrýt největší lokalitu" one-click toggle
   *  on /sbirka — the dominant location holds ~80 % of the collection
   *  and the user often wants to browse "everything else". */
  excludeLocationId?: number;
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
 *  first); `votes-desc` orders by the denormalized vote count cache
 *  (most-loved first). Anonymized finds and finds without GPS get NULL
 *  distance and fall to the end of distance sorts regardless of
 *  direction. */
export type FindSort =
  | "desc"
  | "asc"
  | "dist-asc"
  | "dist-desc"
  | "votes-desc";

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
  if (f.excludeLocationId) {
    // Mirror the inclusion branch above — gather the target location +
    // all direct children (max depth 2) and exclude every find pinned
    // to one of them. The toggle on /sbirka uses this to drop the
    // dominant location's thousands of records in one click. A find
    // with `locationId = null` (location-missing) is never matched by
    // `NOT IN (...)` in SQL — null comparisons are unknown — but
    // Prisma's `not` operator translates to an IS NOT NULL guard
    // around the IN, which would silently drop those finds too. Using
    // an explicit OR with `locationId: null` keeps null-location
    // finds visible, matching the user's expectation: this filter is
    // about a specific known location, not "anything we know about".
    const exChildRows = await prisma.location.findMany({
      where: { parentId: f.excludeLocationId },
      select: { id: true },
    });
    const exIds = [
      f.excludeLocationId,
      ...exChildRows.map((r) => r.id),
    ];
    and.push({
      OR: [
        { locationId: null },
        { locationId: { notIn: exIds } },
      ],
    });
  }
  if (f.cadastralArea) {
    // Same NEEXISTUJE- collapse rule as listLocations: a dropdown
    // pick of "ZLÍN" must also surface finds whose location's
    // cadastralArea is "NEEXISTUJE-ZLÍN" (former locations in the
    // same city). See cityFromCadastralArea() for the rationale.
    const city = cityFromCadastralArea(f.cadastralArea);
    and.push({
      location: {
        cadastralArea: { in: [city, `${NEEXISTUJE_PREFIX}${city}`] },
      },
    });
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
  if (f.dateFrom || f.dateTo) {
    const range: Prisma.DateTimeFilter = {};
    if (f.dateFrom) range.gte = f.dateFrom;
    if (f.dateTo) {
      // Day-inclusive on the upper bound: bump to next-day-midnight UTC
      // so a found_at of e.g. 2024-08-15 23:59:00 still matches `to=2024-08-15`.
      const next = new Date(f.dateTo);
      next.setUTCDate(next.getUTCDate() + 1);
      range.lt = next;
    }
    and.push({ foundAt: range });
  }

  if (f.q && f.q.trim()) {
    const q = f.q.trim();
    const or: Prisma.FindWhereInput[] = [
      // Notes search runs only against finds that are PUBLIC AND
      // non-donated. Anonymized → no notes leak. Donated → notes
      // typically name the recipient, so even surfacing "this find
      // matches keyword X" reveals private context.
      {
        AND: [
          { isAnonymized: false },
          { states: { none: { state: FindState.DONATED } } },
          { notes: { contains: q, mode: "insensitive" } },
        ],
      },
      // displayName branch — only matches when the location has NO
      // anonymized map. Anonymized locations' displayName is the
      // "popisek z lokační mapy" (human note like "Magďul & Pali
      // zahrádka"), which counts as identifying info per CLAUDE.md
      // §6. Code stays open (it's the formal identifier the public
      // /lokality list also shows).
      {
        location: {
          displayName: { contains: q, mode: "insensitive" },
          maps: { none: { isAnonymized: true } },
        },
      },
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

  // Anonymized location IDs — same definition as everywhere else in
  // this codebase: a location counts as anonymized as soon as ANY
  // of its maps has the PNG "Anonymizovaná lokace" tag. Locations
  // here keep their public `code` (the formal identifier shown on
  // /lokality anyway), but `displayName`, `cadastralArea`, and
  // `locationType` get redacted in the per-find return below — they
  // come from the same map description / filename parts that the
  // anonymization rule is meant to suppress.
  const locIdsOnPage = Array.from(
    new Set(rows.map((r) => r.location?.id).filter((id): id is number => id !== undefined)),
  );
  const anonLocRows = locIdsOnPage.length > 0
    ? await prisma.locationMap.findMany({
        where: { locationId: { in: locIdsOnPage }, isAnonymized: true },
        select: { locationId: true },
      })
    : [];
  const anonymizedLocationIds = new Set(anonLocRows.map((r) => r.locationId));

  const ids = rows.map((r) => r.id);
  const coordRows = await prisma.$queryRaw<
    Array<{
      id: number;
      lat: number | null;
      lng: number | null;
      dist_m: number | null;
      loc_offset_m: number | null;
      loc_offset_mode: "polygon" | "center" | null;
      loc_offset_inside: boolean | null;
      loc_offset_within_map: boolean | null;
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
           END AS loc_offset_mode,
           CASE WHEN f.is_anonymized = false AND l.polygon IS NOT NULL
                THEN ST_Covers(l.polygon::geography, f.coordinates::geography)
           END AS loc_offset_inside,
           -- True when the GPS sits inside ANY of the location's
           -- maps' image bounding boxes. Drives the yellow-vs-red
           -- tone split: not-green + within-map = yellow, not-green
           -- + outside-all-maps = red.
           CASE WHEN f.is_anonymized = false THEN
                EXISTS (
                  SELECT 1
                  FROM location_maps lm
                  WHERE lm.location_id = f.location_id
                    AND lm.image_bounds IS NOT NULL
                    AND ST_Y(f.coordinates)
                      BETWEEN (lm.image_bounds->0->>0)::float8
                          AND (lm.image_bounds->1->>0)::float8
                    AND ST_X(f.coordinates)
                      BETWEEN (lm.image_bounds->0->>1)::float8
                          AND (lm.image_bounds->1->>1)::float8
                )
           END AS loc_offset_within_map
    FROM finds f
    LEFT JOIN locations l ON l.id = f.location_id
    WHERE f.id IN (${Prisma.join(ids)}) AND f.coordinates IS NOT NULL
  `;
  const coordsMap = new Map<number, { lat: number; lng: number }>();
  const distMap = new Map<number, number>();
  const offsetMap = new Map<
    number,
    {
      meters: number;
      mode: "polygon" | "center";
      inside: boolean;
      withinMap: boolean;
    }
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
        // `inside` is only meaningful in polygon mode; coalesce to false
        // for center mode so consumers don't have to guard on `mode`.
        inside: c.loc_offset_inside === true,
        withinMap: c.loc_offset_within_map === true,
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
    const states = r.states.map((s) => s.state);
    // Donated finds: notes typically name the recipient or sketch
    // private context of the gift, so they're hidden EVERYWHERE the
    // public payload travels (list, card, detail, OG meta) — not just
    // on the detail page. Centralising the rule here means consumers
    // never have to remember to guard on state.
    const notes = states.includes(FindState.DONATED) ? null : safe.notes;
    // Redact identifying metadata for finds whose LOCATION is
    // anonymized — even if the find itself is non-anonymized. The
    // code stays (formal identifier, public on /lokality); display
    // name + cadastral area + location type all derive from the map
    // description and would defeat the location-level anonymization.
    const locationOut =
      r.location && anonymizedLocationIds.has(r.location.id)
        ? {
            id: r.location.id,
            code: r.location.code,
            displayName: "",
            cadastralArea: "",
            locationType: null,
          }
        : r.location;
    return {
      id: r.id,
      foundAt: r.foundAt,
      notes,
      isAnonymized: r.isAnonymized,
      coordinates: safe.coordinates,
      location: locationOut,
      states,
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
      // Decorated by attachRealPhotoFlags after hydration — the on-disk
      // index isn't in scope here. Anonymized finds force false to keep
      // the indicator from leaking that hidden donations exist.
      hasRealPhoto: false,
      // Same shape for the free-photo indicator, decorated by
      // attachFreePhotoFlags. Anonymized → false.
      hasFreePhoto: false,
    };
  });
}

/** In-place: flips `hasRealPhoto` to true for finds whose ID appears in
 *  the on-disk index. Anonymized finds stay `false` regardless — the
 *  badge would tell visitors that a hidden donation exists, which is
 *  exactly what anonymization is meant to suppress. */
async function attachRealPhotoFlags(finds: PublicFind[]): Promise<void> {
  if (finds.length === 0) return;
  const ids = await getFindIdsWithRealPhotos();
  if (ids.size === 0) return;
  for (const f of finds) {
    if (f.isAnonymized) continue;
    if (ids.has(f.id)) f.hasRealPhoto = true;
  }
}

/** In-place: flips `hasFreePhoto` to true for finds with at least one
 *  `_FOTO` file on disk. Distinct from donation photos so the row can
 *  render two independent badges. Anonymized → no badge. */
async function attachFreePhotoFlags(finds: PublicFind[]): Promise<void> {
  if (finds.length === 0) return;
  const ids = await getFindIdsWithFreePhotos();
  if (ids.size === 0) return;
  for (const f of finds) {
    if (f.isAnonymized) continue;
    if (ids.has(f.id)) f.hasFreePhoto = true;
  }
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
    return listFindsByDistance(where, safePage, pageSize, sort, filters);
  }

  // The "S reálnou fotkou" filter narrows the WHERE down to the IDs in
  // the on-disk find-photos index (filesystem only — no DB column).
  // Apply it before pagination so total + slice both reflect the
  // filtered set; without this, page totals would still report the
  // unfiltered count and the toggle would feel broken.
  const photoWhere = filters.hasRealPhoto
    ? await mergeRealPhotoFilter(where)
    : where;

  // votes-desc uses the denormalized `vote_count` column (kept in
  // sync by the find_votes trigger) so the popularity sort is a
  // single index scan, no group-by per page. Tie-break by id desc
  // so the order stays stable when many finds share `voteCount = 0`.
  const orderBy: Prisma.FindOrderByWithRelationInput[] =
    sort === "votes-desc"
      ? [{ voteCount: "desc" }, { id: "desc" }]
      : [{ id: sort }];

  const [total, rows] = await Promise.all([
    prisma.find.count({ where: photoWhere }),
    prisma.find.findMany({
      where: photoWhere,
      include: LIST_INCLUDE,
      orderBy,
      take: pageSize,
      skip: (safePage - 1) * pageSize,
    }),
  ]);
  const items = await hydrate(rows);
  await attachLocationThumbs(items);
  await attachRealPhotoFlags(items);
  await attachFreePhotoFlags(items);
  return {
    items,
    total,
    page: safePage,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Mixes the `?hasPhoto=1` filter into the existing WHERE by AND-ing
 *  in the IDs from the on-disk photo index. Returns a sentinel WHERE
 *  that matches zero rows when there are no photos at all, so the
 *  caller's `count` + `findMany` collapse to an empty result. */
async function mergeRealPhotoFilter(
  where: Prisma.FindWhereInput,
): Promise<Prisma.FindWhereInput> {
  const ids = await getFindIdsWithRealPhotos();
  if (ids.size === 0) {
    return { AND: [where, { id: -1 }] };
  }
  return {
    AND: [where, { id: { in: [...ids] }, isAnonymized: false }],
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
  filters: FindFilters,
): Promise<FindListResult> {
  const photoWhere = filters.hasRealPhoto
    ? await mergeRealPhotoFilter(where)
    : where;
  const idRows = await prisma.find.findMany({
    where: photoWhere,
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
  await attachRealPhotoFlags(items);
  await attachFreePhotoFlags(items);
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
  /** Donation photos bound to this find. Empty array when none on disk
   *  or when the find is anonymized (we don't want the modal to
   *  reveal that hidden donations exist). ANON entries carry
   *  `url: null` — the modal renders a placeholder until the visitor
   *  unlocks them via the unlockFindPhotos server action. */
  donationPhotos: readonly FindPhotoEntry[];
  /** "Free" photos — extra snapshots the author chose to publish for
   *  this find. Always public (no anonymized variant). Empty for
   *  anonymized finds — same rationale as donationPhotos: no leak. */
  freePhotos: readonly FindFreePhotoEntry[];
  /** This find's date-order position among all finds at the same
   *  location, plus neighbour-find IDs in the same ordering for the
   *  prev/next navigation chips. `null` when the find has no
   *  location, OR when it's anonymized (the displayed "location" is
   *  the privacy placeholder — counting against placeholder finds
   *  would be misleading). The ordering is `found_at ASC NULLS LAST,
   *  id ASC`, which mirrors what the operator sees if they filter
   *  /sbirka by that location + sort by oldest. `prevId` / `nextId`
   *  are null at the chain boundaries (first/last find at the
   *  location). */
  rankAtLocation: {
    rank: number;
    total: number;
    prevId: number | null;
    nextId: number | null;
  } | null;
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
      donationPhotos: [],
      freePhotos: [],
      // Anonymized finds get no rank: the displayed location is a
      // privacy placeholder, not where the find actually is, so
      // counting against the placeholder's finds would mislead.
      rankAtLocation: null,
    };
  }

  // Non-anonymized: show whatever maps we have for this location +
  // every donation photo bound to this find. The detail page only
  // queries findPhotos here so the helper's directory cache stays
  // warm for the matching list query within the same revalidate
  // window.
  const [locationMaps, donationPhotos, freePhotos, rankAtLocation] =
    await Promise.all([
      hydrated.location
        ? fetchLocationMaps(hydrated.location.id, hydrated.coordinates)
        : Promise.resolve([] as PublicLocationMap[]),
      getFindPhotos(hydrated.id),
      getFindFreePhotos(hydrated.id),
      hydrated.location
        ? fetchRankAtLocation(hydrated.id, hydrated.location.id)
        : Promise.resolve(null),
    ]);
  // hasRealPhoto is the public flag the list rows already use; mirror it
  // on the detail so card-equivalent gates (e.g. share buttons) stay
  // consistent even when the visitor lands directly on /sbirka/N.
  // hasFreePhoto follows the same idea for the secondary gallery.
  const detailWithFlag = {
    ...hydrated,
    hasRealPhoto: donationPhotos.length > 0,
    hasFreePhoto: freePhotos.length > 0,
  };
  return {
    ...detailWithFlag,
    locationMaps,
    donationPhotos,
    freePhotos,
    rankAtLocation,
  };
}

/** This find's date-order position among finds at the same location,
 *  plus neighbour-find IDs (LAG/LEAD) for the prev/next nav chips
 *  the detail page shows under the rank line.
 *
 *  Ordering: `found_at ASC NULLS LAST, id ASC` — dated finds first
 *  oldest-to-newest, undated ones at the end by id (matches the
 *  /sbirka "oldest first" sort for the same location filter).
 *
 *  Single window pass shares the ORDER BY across ROW_NUMBER + LAG +
 *  LEAD via a named WINDOW clause so the planner doesn't sort the
 *  partition twice. `prev_id` / `next_id` come back null at the
 *  chain boundaries (first/last find at the location).
 *
 *  Returns `null` when the find isn't actually present at the
 *  location anymore (shouldn't happen in practice — the caller has
 *  already loaded the find with a valid location_id — but the typed
 *  null lets the page hide the row instead of rendering "?. find of
 *  ?" if data drifts mid-render). */
async function fetchRankAtLocation(
  findId: number,
  locationId: number,
): Promise<{
  rank: number;
  total: number;
  prevId: number | null;
  nextId: number | null;
} | null> {
  type Row = {
    rank: number;
    total: number;
    prev_id: number | null;
    next_id: number | null;
  };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT rank, total, prev_id, next_id
    FROM (
      SELECT
        id,
        (ROW_NUMBER() OVER w)::int AS rank,
        (COUNT(*) OVER ())::int AS total,
        LAG(id) OVER w AS prev_id,
        LEAD(id) OVER w AS next_id
      FROM finds
      WHERE location_id = ${locationId}
      WINDOW w AS (ORDER BY found_at ASC NULLS LAST, id ASC)
    ) ranked
    WHERE id = ${findId}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    rank: row.rank,
    total: row.total,
    prevId: row.prev_id,
    nextId: row.next_id,
  };
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
  /** Find's recorded time (from EXIF). Surfaced in the highlight popup
   *  so the visitor can read date+seconds at a glance. Null when the
   *  find row predates timestamps in the importer. */
  foundAt: Date | null;
  /** Code of the find's location (e.g. ZLÍN_JSVAHY-UTB-U5-001), used as
   *  the primary identifier line in the popup. Null only when the find
   *  isn't tied to any location row (extremely rare). */
  locationCode: string | null;
  /** Human description of the location (`displayName`), used as a
   *  secondary line under the code when distinct from it. */
  locationDisplayName: string | null;
  offset: {
    meters: number;
    mode: "polygon" | "center";
    inside: boolean;
  } | null;
}

export async function getHighlightFind(
  id: number,
): Promise<HighlightFind | null> {
  const row = await prisma.find.findUnique({
    where: { id },
    select: {
      id: true,
      isAnonymized: true,
      locationId: true,
      foundAt: true,
      location: { select: { code: true, displayName: true } },
    },
  });
  if (!row || row.isAnonymized) return null;

  const coordRows = await prisma.$queryRaw<
    Array<{
      lat: number | null;
      lng: number | null;
      loc_offset_m: number | null;
      loc_offset_mode: "polygon" | "center" | null;
      loc_offset_inside: boolean | null;
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
           END AS loc_offset_mode,
           CASE WHEN l.polygon IS NOT NULL
                THEN ST_Covers(l.polygon::geography, f.coordinates::geography)
           END AS loc_offset_inside
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
    foundAt: row.foundAt,
    locationCode: row.location?.code ?? null,
    locationDisplayName: row.location?.displayName ?? null,
    offset:
      c.loc_offset_m !== null && c.loc_offset_mode !== null
        ? {
            meters: c.loc_offset_m,
            mode: c.loc_offset_mode,
            inside: c.loc_offset_inside === true,
          }
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
  /** Earliest `found_at` across the collection, formatted YYYY-MM-DD.
   *  Drives the lower bound (and default value) of the date-range
   *  picker. `null` when the collection is empty. */
  minDate: string | null;
  /** Latest `found_at`, formatted YYYY-MM-DD. */
  maxDate: string | null;
}

export async function getFilterOptions(): Promise<FilterOptions> {
  const [locations, yearRows, cities, countries, dateBounds, anonMaps] =
    await Promise.all([
      prisma.location.findMany({
        select: { id: true, code: true, displayName: true },
        orderBy: { code: "asc" },
      }),
      prisma.$queryRaw<Array<{ year: number }>>`
        SELECT DISTINCT EXTRACT(YEAR FROM found_at)::int AS year
        FROM finds
        WHERE found_at IS NOT NULL
        ORDER BY year ASC
      `,
      listCadastralAreas(),
      listCountries(),
      prisma.find.aggregate({
        _min: { foundAt: true },
        _max: { foundAt: true },
        where: { foundAt: { not: null } },
      }),
      // Per-map anonymization flag — a Location counts as anonymized as
      // soon as ANY of its maps has the PNG "Anonymizovaná lokace" tag
      // set. Same rule that drives /lokality's privacy strip; reused
      // here so the filter dropdown can suppress the displayName side
      // of the label for those rows (the bare `code` is still public —
      // it matches what /lokality renders for anonymized rows).
      prisma.locationMap.findMany({
        where: { isAnonymized: true },
        select: { locationId: true },
      }),
    ]);

  const anonymizedLocationIds = new Set<number>(
    anonMaps.map((m) => m.locationId),
  );

  return {
    locations: locations.map((l) => {
      const isAnonymized = anonymizedLocationIds.has(l.id);
      // Code is the formal identifier; displayName is the human note
      // ("note" in user-speak). For anonymized locations we drop the
      // displayName — leaving it visible here would leak through the
      // filter UI even though /lokality already strips it. For public
      // ones, show "<code> — <displayName>" so visitors can recognize
      // a location either way.
      const showDisplay =
        !isAnonymized &&
        l.displayName &&
        l.displayName.trim() &&
        l.displayName !== l.code;
      return {
        id: l.id,
        label: showDisplay ? `${l.code} — ${l.displayName}` : l.code,
      };
    }),
    cities,
    countries,
    states: Object.values(FindState),
    years: yearRows.map((r) => r.year),
    minDate: dateBounds._min.foundAt
      ? dateBounds._min.foundAt.toISOString().slice(0, 10)
      : null,
    maxDate: dateBounds._max.foundAt
      ? dateBounds._max.foundAt.toISOString().slice(0, 10)
      : null,
  };
}

/** Simple totals for the home page. */
export interface CollectionProgress {
  count: number;
  minFindId: number | null;
  maxFindId: number | null;
  /** Sequential ID ranges that are missing within `[minFindId, maxFindId]`.
   *  Each entry covers a contiguous block of unfilled IDs (`start === end`
   *  for a single missing ID). Empty when the range is dense. */
  gaps: Array<{ start: number; end: number }>;
}

/**
 * Range + count of find IDs currently in the DB. Used by /sbirka to flag
 * a back-catalog import that hasn't reached find #1 yet (or that has
 * gaps within its current range). Cheap — one count + a min/max query +
 * one window-function pass over the id column.
 */
export async function getCollectionProgress(): Promise<CollectionProgress> {
  const [count, range, gapRows] = await Promise.all([
    prisma.find.count(),
    prisma.$queryRaw<Array<{ min_id: number | null; max_id: number | null }>>`
      SELECT MIN(id)::int AS min_id, MAX(id)::int AS max_id FROM finds
    `,
    // Detect gaps via LAG: for every find whose immediate predecessor by
    // id is more than 1 step away, the missing chunk is (prev+1 .. id-1).
    // Returns one row per gap, ordered low→high.
    prisma.$queryRaw<Array<{ gap_start: number; gap_end: number }>>`
      SELECT (prev_id + 1)::int AS gap_start, (id - 1)::int AS gap_end
      FROM (
        SELECT id, LAG(id) OVER (ORDER BY id) AS prev_id FROM finds
      ) t
      WHERE prev_id IS NOT NULL AND id - prev_id > 1
      ORDER BY gap_start
    `,
  ]);
  const r = range[0];
  if (count === 0 || !r || r.min_id === null || r.max_id === null) {
    return { count, minFindId: null, maxFindId: null, gaps: [] };
  }
  return {
    count,
    minFindId: r.min_id,
    maxFindId: r.max_id,
    gaps: gapRows.map((g) => ({ start: g.gap_start, end: g.gap_end })),
  };
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
