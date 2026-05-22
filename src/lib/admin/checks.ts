import { prisma } from "@/lib/db";

/** Result of a single consistency check. The page renders one card
 *  per result; an empty `offenders` array is the green-check case. */
export interface CheckResult {
  id: string;
  /** Czech title for the card header. */
  title: string;
  /** One-sentence description of what the invariant says. */
  description: string;
  /** Per-row offenders. Each entry references a find id + a short
   *  context line (location code / name / "no location"). */
  offenders: CheckOffender[];
}

export interface CheckOffender {
  findId: number;
  /** Location code when the find has one; "—" otherwise. */
  locationCode: string;
  /** Human-readable label / explanation of the violation. */
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
  const offenders: CheckOffender[] = [];
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

export async function runAllChecks(): Promise<CheckResult[]> {
  return Promise.all([
    checkFindsInAnonLocsNotAnon(),
    checkAnonFindsInPublicLoc(),
    checkFindsWithoutDate(),
    checkOriginalsWithoutCrop(),
  ]);
}

/** Stable id of the EXIF check — shared between the checks page (card
 *  title), the summary helper (per-check count), and any other
 *  surface that wants to cross-reference it. Pulled into a const so
 *  refactors of the check name don't require grepping for the string. */
export const EXIF_CHECK_ID = "finds-without-date";

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
}> {
  const results = await runAllChecks();
  let totalIssues = 0;
  let failedChecks = 0;
  let exifIssues = 0;
  for (const r of results) {
    if (r.offenders.length > 0) {
      failedChecks += 1;
      totalIssues += r.offenders.length;
    }
    if (r.id === EXIF_CHECK_ID) {
      exifIssues = r.offenders.length;
    }
  }
  return {
    totalIssues,
    failedChecks,
    totalChecks: results.length,
    exifIssues,
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
