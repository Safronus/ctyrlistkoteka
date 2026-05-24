import { prisma } from "@/lib/db";
import { readCheckAckSet } from "./checkAcks";

/** Result of a single consistency check. The page renders one card
 *  per result; an empty `offenders` array is the green-check case.
 *
 *  Checks come in two flavours: most flag *finds* (linking to
 *  /sbirka/<id>), one flags *location maps* (linking to the admin
 *  map detail page). The discriminated union keeps the table layout
 *  type-safe — every check knows which row shape it produces and
 *  the page renders the matching column headers + link targets. */
export type CheckResult = FindCheckResult | MapCheckResult;

interface BaseCheckResult {
  /** Stable id for cross-referencing (file-list filters, summary
   *  helpers). Renames here require updating EXIF_CHECK_ID / GPS_CHECK_ID
   *  + every consumer that hard-codes the string. */
  id: string;
  /** Czech title for the card header. */
  title: string;
  /** One-sentence description of what the invariant says. */
  description: string;
}

export interface FindCheckResult extends BaseCheckResult {
  kind: "find";
  offenders: FindOffender[];
}

export interface MapCheckResult extends BaseCheckResult {
  kind: "map";
  offenders: MapOffender[];
}

export interface FindOffender {
  findId: number;
  /** Location code when the find has one; "—" otherwise. */
  locationCode: string;
  /** Human-readable label / explanation of the violation. */
  detail: string;
}

export interface MapOffender {
  mapId: number;
  /** PNG filename on disk — used to link the offender row to
   *  /admin/files/maps/<filename>. */
  originalFilename: string;
  locationCode: string;
  detail: string;
}


/** Returns the set of location ids that should be treated as
 *  anonymised — i.e. those with at least one LocationMap row whose
 *  PNG metadata flag was true at last sync. Mirrors the rule used by
 *  the public listLocations query (a single anonymised map flags the
 *  whole location, privacy-first). */
async function getAnonymizedLocationIds(): Promise<Set<number>> {
  const rows = await prisma.locationMap.findMany({
    where: { isAnonymized: true },
    select: { locationId: true },
    distinct: ["locationId"],
  });
  return new Set(rows.map((r) => r.locationId));
}

/** Loads a (id → code) lookup for the given location ids in one
 *  trip. Used to enrich offender rows with a human-readable label. */
async function loadLocationCodes(
  ids: readonly number[],
): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.location.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, code: true },
  });
  return new Map(rows.map((r) => [r.id, r.code]));
}

/** Check 1 — every find sitting on an anonymised location must
 *  itself carry the anonymisation flag. The fix path is the new
 *  `setFindAnonymized` action: flip pole 5 from NE to ANO and add
 *  the id to JSON anonymizace. */
async function checkFindsInAnonLocsNotAnon(): Promise<CheckResult> {
  const anonLocIds = await getAnonymizedLocationIds();
  if (anonLocIds.size === 0) {
    return {
      kind: "find",
      id: "finds-in-anon-loc-not-anon",
      title: "Nálezy v anonymizované lokalitě bez anonymizace",
      description:
        "Každý nález v lokalitě s anonymizovanou mapou musí mít sám nastavenou anonymizaci (pole 5 = ANO).",
      offenders: [],
    };
  }
  const finds = await prisma.find.findMany({
    where: {
      locationId: { in: [...anonLocIds] },
      isAnonymized: false,
    },
    select: { id: true, locationId: true },
    orderBy: { id: "asc" },
  });
  const codes = await loadLocationCodes(
    finds.map((f) => f.locationId).filter((x): x is number => x !== null),
  );
  return {
    kind: "find",
    id: "finds-in-anon-loc-not-anon",
    title: "Nálezy v anonymizované lokalitě bez anonymizace",
    description:
      "Každý nález v lokalitě s anonymizovanou mapou musí mít sám nastavenou anonymizaci (pole 5 = ANO).",
    offenders: finds.map((f) => ({
      findId: f.id,
      locationCode:
        f.locationId !== null
          ? (codes.get(f.locationId) ?? `#${f.locationId}`)
          : "—",
      detail:
        "Lokalita má anonymizovanou mapu, ale nález není anonymizovaný.",
    })),
  };
}

/** Check 2 — inverse: every anonymised find should be in a location
 *  that's also anonymised. A find can in principle be anonymised in
 *  isolation, but the user wants this surfaced for review. */
async function checkAnonFindsInPublicLoc(): Promise<CheckResult> {
  const anonLocIds = await getAnonymizedLocationIds();
  const anonFinds = await prisma.find.findMany({
    where: { isAnonymized: true },
    select: { id: true, locationId: true },
    orderBy: { id: "asc" },
  });
  const offenders: FindOffender[] = [];
  const idsForCodes: number[] = [];
  for (const f of anonFinds) {
    if (f.locationId === null) {
      offenders.push({
        findId: f.id,
        locationCode: "—",
        detail: "Nález je anonymizovaný, ale není přiřazený k žádné lokalitě.",
      });
      continue;
    }
    if (!anonLocIds.has(f.locationId)) {
      offenders.push({
        findId: f.id,
        locationCode: `#${f.locationId}`,
        detail:
          "Nález je anonymizovaný, ale lokalita anonymizovaná není.",
      });
      idsForCodes.push(f.locationId);
    }
  }
  if (idsForCodes.length > 0) {
    const codes = await loadLocationCodes(idsForCodes);
    for (const o of offenders) {
      if (o.locationCode.startsWith("#")) {
        const id = Number(o.locationCode.slice(1));
        const code = codes.get(id);
        if (code) o.locationCode = code;
      }
    }
  }
  return {
    kind: "find",
    id: "anon-finds-in-public-loc",
    title: "Anonymizované nálezy mimo anonymizovanou lokalitu",
    description:
      "Anonymizované nálezy by měly mít také anonymizovanou lokalitu — jinak je rozdíl jen mezi řádky a metadaty stránky lokality.",
    offenders,
  };
}

/** Check 4 — every find with an ORIGINAL image must also have a CROP.
 *  CROP is what /sbirka and the home thumbnail strip render at small
 *  sizes; missing it means the find shows up unframed (or with a
 *  fallback that includes EXIF burns + watermark backdrop). The fix
 *  path is generating the crop locally and rsyncing it into
 *  data/crops/. */
async function checkOriginalsWithoutCrop(): Promise<CheckResult> {
  // Pull both image-type sets via Prisma; intersecting in JS is
  // cheaper than a DISTINCT-NOT-IN raw query for this size and keeps
  // the schema layer tight to what's already typed.
  const [originals, crops] = await Promise.all([
    prisma.findImage.findMany({
      where: { imageType: "ORIGINAL" },
      select: { findId: true },
      distinct: ["findId"],
    }),
    prisma.findImage.findMany({
      where: { imageType: "CROP" },
      select: { findId: true },
      distinct: ["findId"],
    }),
  ]);
  const cropSet = new Set(crops.map((c) => c.findId));
  const missing = originals
    .map((o) => o.findId)
    .filter((id) => !cropSet.has(id))
    .sort((a, b) => a - b);
  if (missing.length === 0) {
    return {
      kind: "find",
      id: "originals-without-crop",
      title: "Originály bez výřezu",
      description:
        "Každý nález s originálem (data/finds/) musí mít odpovídající výřez (data/crops/) — výřez se renderuje v miniaturách na /sbirka a na home page.",
      offenders: [],
    };
  }
  // Resolve location codes for the offenders in one trip.
  const finds = await prisma.find.findMany({
    where: { id: { in: missing } },
    select: { id: true, locationId: true },
  });
  const codes = await loadLocationCodes(
    finds.map((f) => f.locationId).filter((x): x is number => x !== null),
  );
  const findById = new Map(finds.map((f) => [f.id, f]));
  return {
    kind: "find",
    id: "originals-without-crop",
    title: "Originály bez výřezu",
    description:
      "Každý nález s originálem (data/finds/) musí mít odpovídající výřez (data/crops/) — výřez se renderuje v miniaturách na /sbirka a na home page.",
    offenders: missing.map((id) => {
      const f = findById.get(id);
      const locId = f?.locationId ?? null;
      return {
        findId: id,
        locationCode:
          locId !== null ? (codes.get(locId) ?? `#${locId}`) : "—",
        detail: "Originál existuje, výřez chybí.",
      };
    }),
  };
}

/** Check 3 — finds without an EXIF `found_at`. They drop out of every
 *  date-based aggregate (home retrospektiva, /statistiky calendar,
 *  the year filter on /sbirka …) so the admin needs a single place
 *  that lists them. The fix path is usually re-running EXIF extraction
 *  on the source HEIC/JPEG, or manually patching `found_at` in the DB
 *  if the original lost the timestamp. */
async function checkFindsWithoutDate(): Promise<CheckResult> {
  const finds = await prisma.find.findMany({
    where: { foundAt: null },
    select: { id: true, locationId: true },
    orderBy: { id: "asc" },
  });
  const codes = await loadLocationCodes(
    finds.map((f) => f.locationId).filter((x): x is number => x !== null),
  );
  return {
    kind: "find",
    id: "finds-without-date",
    title: "Nálezy bez EXIF data",
    description:
      "Nálezy bez `foundAt` nepadnou do žádného časového bucketu — chybí v retrospektivě na home page i ve většině řad na /statistiky.",
    offenders: finds.map((f) => ({
      findId: f.id,
      locationCode:
        f.locationId !== null
          ? (codes.get(f.locationId) ?? `#${f.locationId}`)
          : "—",
      detail: "Nález nemá EXIF DateTimeOriginal — chybí časové zařazení.",
    })),
  };
}

/** Check 4 — finds without EXIF GPS coordinates (and not already
 *  flagged NO_GPS in JSON). Same family as the EXIF-date check above:
 *  surfaces files whose upload pipeline either stripped GPS metadata
 *  or never had it, so the find lacks a position on /mapa and in the
 *  geo-bucket aggregations. Finds with an explicit NO_GPS state
 *  assignment are *excluded* — the user already declared them GPSless
 *  intentionally (e.g., the photo was taken indoors with location
 *  services off), so listing them again is just noise.
 *
 *  Uses raw SQL because `Find.coordinates` is a PostGIS geometry
 *  (Unsupported in Prisma's typed query). The NOT EXISTS subquery
 *  keeps anonymization-orthogonal — anonymized finds *can* have GPS
 *  in the DB, the privacy layer just hides it on render. */
async function checkFindsWithoutGps(): Promise<CheckResult> {
  const rows = await prisma.$queryRaw<
    Array<{ id: number; location_id: number | null }>
  >`
    SELECT f.id, f.location_id
    FROM finds f
    WHERE f.coordinates IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM find_state_assignments fsa
        WHERE fsa.find_id = f.id AND fsa.state = 'NO_GPS'
      )
    ORDER BY f.id ASC
  `;
  const codes = await loadLocationCodes(
    rows.map((r) => r.location_id).filter((x): x is number => x !== null),
  );
  return {
    kind: "find",
    id: "finds-without-gps",
    title: "Nálezy bez EXIF GPS",
    description:
      "Nálezy, jejichž originál nemá v EXIF GPS souřadnice — chybí pak na /mapa a v geo-agregacích na /statistiky. Nálezy se stavem NO_GPS jsou vynechané (autor je označil úmyslně).",
    offenders: rows.map((r) => ({
      findId: r.id,
      locationCode:
        r.location_id !== null
          ? (codes.get(r.location_id) ?? `#${r.location_id}`)
          : "—",
      detail: "Originál nemá EXIF GPS — fix: re-EXIF nebo označit NO_GPS.",
    })),
  };
}

/** Check 6 — location maps whose center marker (the black dot from
 *  the filename's GPS segment) sits OUTSIDE the polygon stored on
 *  the parent location. A polygon traced wrong, a typo in the
 *  filename's GPS coordinates, or a map paired to the wrong
 *  location all surface as this inconsistency. PostGIS does the
 *  containment test in one query — `ST_Covers` instead of
 *  `ST_Within` so a center sitting exactly on the polygon edge
 *  passes (lenient: edge cases are usually fine, not bugs). */
async function checkMapCenterOutsidePolygon(): Promise<MapCheckResult> {
  const [rows, acked] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        id: number;
        original_filename: string;
        location_code: string;
        center_lat: number;
        center_lng: number;
      }>
    >`
      SELECT lm.id,
             lm.original_filename,
             lm.location_code,
             lm.center_lat,
             lm.center_lng
      FROM location_maps lm
      JOIN locations l ON l.id = lm.location_id
      WHERE l.polygon IS NOT NULL
        AND NOT ST_Covers(
          l.polygon,
          ST_SetSRID(ST_MakePoint(lm.center_lng, lm.center_lat), 4326)
        )
      ORDER BY lm.id ASC
    `,
    readCheckAckSet(MAP_CENTER_POLYGON_CHECK_ID),
  ]);
  return {
    kind: "map",
    id: MAP_CENTER_POLYGON_CHECK_ID,
    title: "Lokační mapa: střed mimo polygon",
    description:
      "Mapa má v lokalitě nakreslený polygon, ale středový bod (z GPS v názvu) leží mimo něj. Obvykle špatně obtažený polygon nebo překlep v souřadnicích. Potvrzené záznamy (tlačítko \"OK\") jsou skryté.",
    offenders: rows
      .filter((r) => !acked.has(r.id))
      .map((r) => ({
        mapId: r.id,
        originalFilename: r.original_filename,
        locationCode: r.location_code,
        detail: `Střed ${r.center_lat.toFixed(5)}, ${r.center_lng.toFixed(5)} mimo polygon lokality.`,
      })),
  };
}

/** Stable id for the map-center / polygon mismatch check. Exported
 *  so the ack server action can validate the incoming check id
 *  against this exact value (no free-form check ids = no risk of an
 *  attacker writing arbitrary keys into check-acks.json). */
export const MAP_CENTER_POLYGON_CHECK_ID = "map-center-outside-polygon";

export async function runAllChecks(): Promise<CheckResult[]> {
  return Promise.all([
    checkFindsInAnonLocsNotAnon(),
    checkAnonFindsInPublicLoc(),
    checkFindsWithoutDate(),
    checkFindsWithoutGps(),
    checkOriginalsWithoutCrop(),
    checkMapCenterOutsidePolygon(),
  ]);
}

/** Stable id of the EXIF check — shared between the checks page (card
 *  title), the summary helper (per-check count), and any other
 *  surface that wants to cross-reference it. Pulled into a const so
 *  refactors of the check name don't require grepping for the string. */
export const EXIF_CHECK_ID = "finds-without-date";

/** Stable id of the GPS check. Same role as EXIF_CHECK_ID — lets the
 *  checks page render the matching link buttons + lets the summary
 *  + file list cross-reference the check without duplicating the
 *  literal string. */
export const GPS_CHECK_ID = "finds-without-gps";

/** Lightweight summary of all checks — used by the admin home page
 *  to colour the "Kontroly konzistence" card without rendering the
 *  full offender tables. Reuses runAllChecks under the hood so a
 *  single source of truth drives both the summary and the
 *  per-check page.
 *
 *  `exifIssues` is split out separately so the sync page + file
 *  lists can surface a targeted warning ("X EXIF problems") without
 *  having to re-run the full check or guess from the aggregate. */
export async function runChecksSummary(): Promise<{
  totalIssues: number;
  failedChecks: number;
  totalChecks: number;
  exifIssues: number;
  gpsIssues: number;
}> {
  const results = await runAllChecks();
  let totalIssues = 0;
  let failedChecks = 0;
  let exifIssues = 0;
  let gpsIssues = 0;
  for (const r of results) {
    if (r.offenders.length > 0) {
      failedChecks += 1;
      totalIssues += r.offenders.length;
    }
    if (r.id === EXIF_CHECK_ID) {
      exifIssues = r.offenders.length;
    }
    if (r.id === GPS_CHECK_ID) {
      gpsIssues = r.offenders.length;
    }
  }
  return {
    totalIssues,
    failedChecks,
    totalChecks: results.length,
    exifIssues,
    gpsIssues,
  };
}

/** Returns the set of find IDs that the EXIF check flagged as
 *  missing `foundAt`. Used by:
 *   - /admin/files/{finds,crops}?exif_broken=1 to filter the file
 *     list down to only the broken rows.
 *   - the same file list always, to render a per-row warning
 *     indicator so the operator notices issues even when viewing
 *     unfiltered.
 *   - /admin/sync to gate sync runs behind a "fix EXIF first"
 *     warning banner.
 *
 *  The query mirrors `checkFindsWithoutDate()` — same WHERE clause,
 *  just returns ids instead of building a CheckResult. Kept as a
 *  separate function so callers that only need the membership set
 *  don't pay for the location-code lookup. */
export async function getFindIdsWithExifProblems(): Promise<Set<number>> {
  const rows = await prisma.find.findMany({
    where: { foundAt: null },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/** Returns the set of find IDs that the GPS check flagged as missing
 *  EXIF coordinates (excluding those already flagged NO_GPS). Same
 *  role as `getFindIdsWithExifProblems` — drives the per-row "bez
 *  GPS" indicator + the `?gps_broken=1` filter on file lists. */
export async function getFindIdsWithoutGps(): Promise<Set<number>> {
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT f.id FROM finds f
    WHERE f.coordinates IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM find_state_assignments fsa
        WHERE fsa.find_id = f.id AND fsa.state = 'NO_GPS'
      )
  `;
  return new Set(rows.map((r) => r.id));
}
