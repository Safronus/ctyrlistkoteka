import path from "node:path";
import { promises as fs } from "node:fs";
import { FindState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { readCheckAckSet } from "./checkAcks";
import { parseRanges } from "@/lib/parseRanges";
import {
  parseFindFilename,
  type ParsedFindFilename,
} from "@/lib/parseFilename";
import {
  LOKACE_STAVY_POZNAMKY_FILENAME,
  lokaceStavyPoznamkySchema,
  type LokaceStavyPoznamky,
} from "./jsonSchema";
import { ADMIN_ROOTS } from "./paths";

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
  /** Section label rendered as a heading on /admin/checks. Checks
   *  sharing a group render under the same heading, in the order
   *  they appear in runAllChecks(). Keep groups few and recognisable
   *  — three is the current sweet spot. */
  group: CheckGroup;
}

/** Top-level grouping. `data-integrity` covers invariants that live
 *  purely in the DB; `filesystem-vs-json` is for inconsistencies
 *  between on-disk filenames and the LokaceStavyPoznamky.json source
 *  of truth; `filename-cross-ref` is for cross-file consistency
 *  (original ↔ crop). The string values are stable so future tags /
 *  filtering won't shift. */
export type CheckGroup =
  | "data-integrity"
  | "filesystem-vs-json"
  | "filename-cross-ref";

export const CHECK_GROUP_LABELS: Record<CheckGroup, string> = {
  "data-integrity": "Konzistence dat v DB",
  "filesystem-vs-json": "Konzistence názvů souborů a JSON",
  "filename-cross-ref": "Originály ↔ ořezy",
};

/** Render order for the page — fixed so groups appear top-down in a
 *  meaningful sequence (DB facts first, then file-system, then
 *  cross-file). */
export const CHECK_GROUP_ORDER: readonly CheckGroup[] = [
  "data-integrity",
  "filesystem-vs-json",
  "filename-cross-ref",
];

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
      group: "data-integrity",
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
    group: "data-integrity",
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
    group: "data-integrity",
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
      group: "data-integrity",
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
    group: "data-integrity",
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
    group: "data-integrity",
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
    group: "data-integrity",
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
    group: "data-integrity",
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

/** Check 7 — invariant: at most one `FindImage` per find may carry
 *  `isPrimary = true`. The current sequential sync loop preserves
 *  the rule by construction (ORIGINAL is inserted before CROP, the
 *  second row sees `hasAnyPrimary = true` and inserts with `false`),
 *  but a future parallel pipeline that processes ORIGINAL + CROP
 *  streams concurrently would race the `findFirst(isPrimary=true)`
 *  check between them and could land two primaries. This check
 *  surfaces that drift immediately instead of waiting for a
 *  visitor to notice the "wrong" thumbnail being chosen on /sbirka.
 *
 *  Pure SQL aggregate — cheaper than pulling N rows and counting in
 *  JS, and the GROUP BY ... HAVING idiom matches what a DB-side
 *  trigger would do if we ever promoted this to a hard constraint. */
async function checkMultiplePrimaryImages(): Promise<FindCheckResult> {
  const rows = await prisma.$queryRaw<
    Array<{ find_id: number; cnt: bigint }>
  >`
    SELECT find_id, COUNT(*)::bigint AS cnt
    FROM find_images
    WHERE is_primary = true
    GROUP BY find_id
    HAVING COUNT(*) > 1
    ORDER BY find_id ASC
  `;
  const findIds = rows.map((r) => r.find_id);
  // Resolve location codes for the offenders' rows. Single trip via
  // the existing helper so the table column reads the same as every
  // other check.
  const finds = findIds.length
    ? await prisma.find.findMany({
        where: { id: { in: findIds } },
        select: { id: true, locationId: true },
      })
    : [];
  const codes = await loadLocationCodes(
    finds.map((f) => f.locationId).filter((x): x is number => x !== null),
  );
  const locById = new Map(finds.map((f) => [f.id, f.locationId]));
  return {
    kind: "find",
    group: "data-integrity",
    id: "multi-primary-find-images",
    title: "Nálezy s více než jedním primárním obrázkem",
    description:
      "Invariant: každý nález má nejvýš jeden FindImage s isPrimary = true (ORIGINAL je primární, CROP ne). Více primárních obrázků naruší výběr náhledu na /sbirka a /home — fix je nastavit isPrimary = false na nadbytečném řádku (ručně v DB nebo přes re-sync s --force-regen).",
    offenders: rows.map((r) => {
      const locId = locById.get(r.find_id) ?? null;
      return {
        findId: r.find_id,
        locationCode:
          locId !== null ? (codes.get(locId) ?? `#${locId}`) : "—",
        detail: `${r.cnt} řádků find_images má is_primary = true.`,
      };
    }),
  };
}

// ─────────────────────────────────────────────────────────────────
//  Filesystem ↔ JSON consistency checks (group: filesystem-vs-json)
// ─────────────────────────────────────────────────────────────────

/** Read + parse data/meta/LokaceStavyPoznamky.json. Returns null on
 *  any read/parse/validation failure — the check itself will surface
 *  a single "JSON missing" offender row rather than crash the page. */
async function loadLokaceStavyPoznamky(): Promise<LokaceStavyPoznamky | null> {
  try {
    const raw = await fs.readFile(
      path.join(ADMIN_ROOTS.meta, LOKACE_STAVY_POZNAMKY_FILENAME),
      "utf8",
    );
    const parsed = lokaceStavyPoznamkySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Parsed find filename + the raw on-disk name. The pair lets the
 *  consistency checks both compare segments (state, anon, lokace)
 *  and report the offending filename verbatim in the offender
 *  detail string. */
type ParsedFindOnDisk = ParsedFindFilename & { filename: string };

/** Read every original from `data/finds/`, parse each filename, and
 *  return a `findId → parsed metadata` map. Names that fail the
 *  parser are skipped (a separate "Originály bez crops" / EXIF
 *  pipeline would already surface a parse-broken original). One
 *  readdir per call; fine for the ~17 k file directory we work with. */
async function loadOriginalParsedByFindId(): Promise<
  Map<number, ParsedFindOnDisk>
> {
  const dir = ADMIN_ROOTS.findOriginals;
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw err;
  }
  const out = new Map<number, ParsedFindOnDisk>();
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const parsed = parseFindFilename(name);
    if (!parsed.ok) continue;
    out.set(parsed.value.findId, { ...parsed.value, filename: name });
  }
  return out;
}

/** Map from JSON stavy keys → the FindState enum the filename's
 *  STATE segment must resolve to so the two are consistent. Only
 *  the states encodable in a filename appear here; JSON-only states
 *  (LOST, GIGANT, LOCATION_*…) live entirely in JSON and don't
 *  flag the filename either way. */
const FILENAME_ENCODED_STATE_KEYS: ReadonlyArray<{
  jsonKey: string;
  state: FindState;
  jsonLabel: string;
  filenameLabel: string;
}> = [
  { jsonKey: "DAROVANY", state: FindState.DONATED, jsonLabel: "DAROVANY", filenameLabel: "DAROVANÝ" },
  { jsonKey: "BEZGPS", state: FindState.NO_GPS, jsonLabel: "BEZGPS", filenameLabel: "BEZGPS" },
  { jsonKey: "BEZFOTKY", state: FindState.NO_PHOTO, jsonLabel: "BEZFOTKY", filenameLabel: "BEZFOTKY" },
];

/** Check — every original on disk must have its segments backed by
 *  the JSON source of truth. Surfaces:
 *
 *   - STATE token in filename (DAROVANÝ / BEZGPS / BEZFOTKY) but
 *     the find id is NOT in the matching JSON `stavy` range.
 *   - ANON_FLAG = ANO but id not in `anonymizace.ANONYMIZOVANE`.
 *   - NOTE_OR_FLAG carries a real note but `poznamky[id]` empty/missing.
 *   - LOCATION_CODE used but id not in `lokace[<code>]` range.
 *
 *  One offender row per find, with `detail` listing every mismatch
 *  comma-separated so a single visual scan covers the find's full
 *  diff against JSON.
 *
 *  This is the "did I forget to update JSON after a rename?" half
 *  of the pair — its counterpart `checkJsonNotInFilename` walks
 *  the inverse direction. */
async function checkFilenameNotInJson(): Promise<FindCheckResult> {
  const [originals, json] = await Promise.all([
    loadOriginalParsedByFindId(),
    loadLokaceStavyPoznamky(),
  ]);
  const baseResult = {
    kind: "find" as const,
    group: "filesystem-vs-json" as const,
    id: "filename-not-in-json",
    title: "Originály bez opory v JSON",
    description:
      "Originál na disku nese hodnotu (stav / ANO / poznámka / kód lokace), kterou LokaceStavyPoznamky.json nepotvrzuje — pravděpodobně chybí update JSONu po přejmenování souboru.",
  };
  if (!json) {
    return {
      ...baseResult,
      offenders: [
        {
          findId: 0,
          locationCode: "—",
          detail:
            "LokaceStavyPoznamky.json se nepodařilo načíst nebo neprošel validací — kontrolu nelze spustit.",
        },
      ],
    };
  }
  // Pre-build O(1) lookups from the JSON ranges so the inner loop
  // doesn't re-parse the same range string thousands of times.
  const stavyMembers: ReadonlyMap<string, Set<number>> = new Map(
    FILENAME_ENCODED_STATE_KEYS.map(({ jsonKey }) => [
      jsonKey,
      new Set(parseRanges(json.stavy[jsonKey as keyof typeof json.stavy] ?? [])),
    ]),
  );
  const anonSet = new Set(parseRanges(json.anonymizace.ANONYMIZOVANE));
  // json.lokace is keyed by MAP NUMBER as a decimal string (not the
  // human location code, not zero-padded). Example fragment:
  //   "lokace": { "1": ["15-35"], "10": [...], "100": [...] }
  // Filenames carry mapNumber as a 5-digit zero-padded segment
  // (`00001` / `00010` / `00100`), so we have to convert to the
  // decimal-string form before looking up. Confirmed against
  // scripts/examples/LokaceStavyPoznamky.sample.json.
  const lokaceMembers: Map<string, Set<number>> = new Map();
  for (const [mapKey, ranges] of Object.entries(json.lokace)) {
    lokaceMembers.set(mapKey, new Set(parseRanges(ranges)));
  }

  const offenders: FindOffender[] = [];
  for (const [findId, parsed] of originals) {
    const issues: string[] = [];

    // STATE: only the three states a filename can encode are
    // checked. NORMAL filenames need nothing; JSON-only states
    // (LOST, GIGANT, …) can sit on a NORMÁLNÍ filename.
    for (const spec of FILENAME_ENCODED_STATE_KEYS) {
      if (parsed.state === spec.state) {
        const members = stavyMembers.get(spec.jsonKey);
        if (!members || !members.has(findId)) {
          issues.push(
            `název má stav ${spec.filenameLabel}, JSON.stavy.${spec.jsonLabel} ho ale neobsahuje`,
          );
        }
      }
    }

    // ANON: ANO ⇒ JSON.anonymizace.ANONYMIZOVANE
    if (parsed.isAnonymized && !anonSet.has(findId)) {
      issues.push("název má ANO, JSON.anonymizace.ANONYMIZOVANE ho ale neobsahuje");
    }

    // Note presence: filename carries free-form note ⇒ JSON.poznamky entry
    if (parsed.hasNote) {
      const jsonNote = json.poznamky[String(findId)];
      if (!jsonNote || jsonNote.trim().length === 0) {
        issues.push("název má poznámku, JSON.poznamky pro tento nález nic nemá");
      }
    }

    // MAP_NUMBER: filename's map number must list this id in
    // json.lokace[<mapNumber>]. Compare decimal-string forms (JSON
    // is unpadded). If the map number isn't a JSON key at all → flag.
    const mapKey = String(parsed.mapNumber);
    const locMembers = lokaceMembers.get(mapKey);
    if (!locMembers) {
      issues.push(
        `název má mapu č. ${mapKey}, JSON.lokace ten klíč nezná`,
      );
    } else if (!locMembers.has(findId)) {
      issues.push(
        `název má mapu č. ${mapKey}, ale JSON.lokace[${mapKey}] tento nález neobsahuje`,
      );
    }

    if (issues.length > 0) {
      offenders.push({
        findId,
        locationCode: parsed.locationCode,
        detail: issues.join("; "),
      });
    }
  }

  return { ...baseResult, offenders };
}

/** Inverse check — JSON claims something about a find, but the
 *  filename on disk doesn't carry the matching token. Surfaces the
 *  "I updated JSON but forgot to rename the file" case. */
async function checkJsonNotInFilename(): Promise<FindCheckResult> {
  const [originals, json] = await Promise.all([
    loadOriginalParsedByFindId(),
    loadLokaceStavyPoznamky(),
  ]);
  const baseResult = {
    kind: "find" as const,
    group: "filesystem-vs-json" as const,
    id: "json-not-in-filename",
    title: "JSON položky bez odpovídajícího názvu souboru",
    description:
      "JSON.LokaceStavyPoznamky pro nález uvádí stav / anonymizaci / poznámku / lokaci, kterou ale název souboru originálu neodráží — pravděpodobně chybí přejmenování souboru po updatu JSONu.",
  };
  if (!json) {
    return {
      ...baseResult,
      offenders: [
        {
          findId: 0,
          locationCode: "—",
          detail:
            "LokaceStavyPoznamky.json se nepodařilo načíst nebo neprošel validací — kontrolu nelze spustit.",
        },
      ],
    };
  }

  // Collect all ids the JSON has something to say about. Map id →
  // issues[] so multiple discrepancies for the same find collapse
  // into a single offender row.
  const issuesById = new Map<number, string[]>();
  const push = (id: number, msg: string) => {
    const arr = issuesById.get(id) ?? [];
    arr.push(msg);
    issuesById.set(id, arr);
  };

  for (const spec of FILENAME_ENCODED_STATE_KEYS) {
    const ids = parseRanges(
      json.stavy[spec.jsonKey as keyof typeof json.stavy] ?? [],
    );
    for (const id of ids) {
      const parsed = originals.get(id);
      if (!parsed) {
        // No original on disk at all. Could be deliberate (the find
        // exists only in JSON for some reason) but it's still
        // surface-worthy — flag once.
        push(id, `JSON.stavy.${spec.jsonLabel} obsahuje nález, na disku ale není žádný originál`);
        continue;
      }
      if (parsed.state !== spec.state) {
        push(
          id,
          `JSON.stavy.${spec.jsonLabel} obsahuje nález, název souboru má stav ${stateToFilenameLabel(parsed.state)}`,
        );
      }
    }
  }

  for (const id of parseRanges(json.anonymizace.ANONYMIZOVANE)) {
    const parsed = originals.get(id);
    if (!parsed) {
      push(id, "JSON.anonymizace.ANONYMIZOVANE obsahuje nález, na disku ale není žádný originál");
      continue;
    }
    if (!parsed.isAnonymized) {
      push(id, "JSON.anonymizace.ANONYMIZOVANE obsahuje nález, název souboru má NE");
    }
  }

  for (const [idStr, note] of Object.entries(json.poznamky)) {
    if (!note || note.trim().length === 0) continue;
    const id = Number(idStr);
    if (!Number.isInteger(id)) continue;
    const parsed = originals.get(id);
    if (!parsed) {
      push(id, "JSON.poznamky má text pro nález, na disku ale není žádný originál");
      continue;
    }
    if (!parsed.hasNote) {
      push(id, "JSON.poznamky má text pro nález, název souboru má BezPoznámky");
    }
  }

  for (const [mapKey, ranges] of Object.entries(json.lokace)) {
    // JSON keys are unpadded decimal map numbers ("1", "10", "100").
    // Filename mapNumber is the same number padded to 5 digits.
    // Compare on the numeric value so padding can't trip us.
    const expectedMapNumber = Number(mapKey);
    for (const id of parseRanges(ranges)) {
      const parsed = originals.get(id);
      if (!parsed) {
        push(
          id,
          `JSON.lokace[${mapKey}] obsahuje nález, na disku ale není žádný originál`,
        );
        continue;
      }
      if (parsed.mapNumber !== expectedMapNumber) {
        push(
          id,
          `JSON.lokace[${mapKey}] obsahuje nález, název souboru ale uvádí mapu č. ${parsed.mapNumber}`,
        );
      }
    }
  }

  const findIds = Array.from(issuesById.keys()).sort((a, b) => a - b);
  // Resolve location codes for the offender's locationCode column.
  // Use DB lookup so finds completely missing from disk also get
  // a stable column label (their JSON.lokace membership maps to a
  // code, but a per-id reverse-lookup needs a tiny pass).
  const codes = await loadLocationCodes(
    (
      await prisma.find.findMany({
        where: { id: { in: findIds } },
        select: { locationId: true },
      })
    )
      .map((f) => f.locationId)
      .filter((x): x is number => x !== null),
  );
  // Reverse map id → map number from JSON lokace. JSON keys are
  // map numbers as decimal strings — so the fallback label is
  // "mapa č. N" rather than a real location code, which we can't
  // derive without a DB hit for orphan finds.
  const idToMapKey = new Map<number, string>();
  for (const [mapKey, ranges] of Object.entries(json.lokace)) {
    for (const id of parseRanges(ranges)) {
      if (!idToMapKey.has(id)) idToMapKey.set(id, mapKey);
    }
  }
  const finds = await prisma.find.findMany({
    where: { id: { in: findIds } },
    select: { id: true, locationId: true },
  });
  const dbLocByFind = new Map(finds.map((f) => [f.id, f.locationId]));

  const offenders: FindOffender[] = findIds.map((id) => {
    const dbLocId = dbLocByFind.get(id) ?? null;
    const locFromDb = dbLocId !== null ? codes.get(dbLocId) ?? null : null;
    const mapKey = idToMapKey.get(id) ?? null;
    return {
      findId: id,
      locationCode:
        locFromDb ?? (mapKey !== null ? `mapa č. ${mapKey}` : "—"),
      detail: (issuesById.get(id) ?? []).join("; "),
    };
  });

  return { ...baseResult, offenders };
}

/** Converts a FindState to the Czech label a filename would carry.
 *  Inverse of FILENAME_STATE_MAP from stateMapping.ts, restricted
 *  to the states a filename can carry. Unknown states (anything
 *  beyond the four encodable ones) get the literal enum value as a
 *  fallback — better than a confusing empty string. */
function stateToFilenameLabel(state: FindState): string {
  switch (state) {
    case FindState.NORMAL:
      return "NORMÁLNÍ";
    case FindState.DONATED:
      return "DAROVANÝ";
    case FindState.NO_GPS:
      return "BEZGPS";
    case FindState.NO_PHOTO:
      return "BEZFOTKY";
    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────────
//  Filename cross-ref checks (group: filename-cross-ref)
// ─────────────────────────────────────────────────────────────────

/** Check — original ↔ crop filename divergence. For each find with
 *  BOTH an original and a long-form crop on disk, the basename
 *  (everything before the final dot) must match exactly. Short-form
 *  crops (`<id>.jpg`) are *intentional shorthand* (see
 *  scripts/sync.ts → scanFindDir) and skipped from this check.
 *
 *  This surfaces cases where the user renamed one but not the other
 *  — e.g. changed STATE to DAROVANÝ on the original via the admin
 *  toggle but the crop file kept the old name. Sync paths typically
 *  rename both, but ad-hoc rsync-after-Mac-rename can split them. */
async function checkOriginalCropFilenameMismatch(): Promise<FindCheckResult> {
  const [originalNames, cropNames] = await Promise.all([
    readScopeFilenames(ADMIN_ROOTS.findOriginals),
    readScopeFilenames(ADMIN_ROOTS.findCrops),
  ]);
  // Build id → {original, crop} pair for finds that have both. Use
  // parseFindFilename's findId — handles long-form on both sides.
  // Crop short-form (`<id>.jpg`) is matched by a dedicated regex so
  // we can skip it explicitly (intentional shorthand, no rename
  // expected).
  const SHORT_CROP_RE = /^(\d+)\.(jpe?g|png|webp)$/i;
  const originalsByFindId = new Map<number, string>();
  for (const name of originalNames) {
    const parsed = parseFindFilename(name);
    if (parsed.ok) originalsByFindId.set(parsed.value.findId, name);
  }
  const cropsByFindId = new Map<number, { name: string; shortForm: boolean }>();
  for (const name of cropNames) {
    const short = SHORT_CROP_RE.exec(name);
    if (short) {
      const id = Number(short[1]);
      if (Number.isInteger(id)) {
        cropsByFindId.set(id, { name, shortForm: true });
      }
      continue;
    }
    const parsed = parseFindFilename(name);
    if (parsed.ok) {
      cropsByFindId.set(parsed.value.findId, { name, shortForm: false });
    }
  }

  // Stem = filename without the trailing `.<ext>`. Diacritics + `+`
  // separators on both sides come from the same authoring pipeline,
  // so a byte-level compare on the NFC-normalised stem is correct.
  const stem = (name: string): string => {
    const dot = name.lastIndexOf(".");
    return (dot === -1 ? name : name.slice(0, dot)).normalize("NFC");
  };

  const offenders: FindOffender[] = [];
  for (const [findId, originalName] of originalsByFindId) {
    const crop = cropsByFindId.get(findId);
    if (!crop) continue; // no crop = a separate check's concern
    if (crop.shortForm) continue; // intentional shorthand
    if (stem(originalName) === stem(crop.name)) continue;
    offenders.push({
      findId,
      locationCode: "—",
      detail: `originál: "${originalName}" · ořez: "${crop.name}"`,
    });
  }
  offenders.sort((a, b) => a.findId - b.findId);

  // Resolve location codes for the offender column. Single trip,
  // matches the pattern other checks use.
  const finds =
    offenders.length > 0
      ? await prisma.find.findMany({
          where: { id: { in: offenders.map((o) => o.findId) } },
          select: { id: true, locationId: true },
        })
      : [];
  const codes = await loadLocationCodes(
    finds.map((f) => f.locationId).filter((x): x is number => x !== null),
  );
  const locByFind = new Map(finds.map((f) => [f.id, f.locationId]));
  for (const o of offenders) {
    const locId = locByFind.get(o.findId) ?? null;
    o.locationCode = locId !== null ? codes.get(locId) ?? `#${locId}` : "—";
  }

  return {
    kind: "find",
    group: "filename-cross-ref",
    id: "original-crop-filename-mismatch",
    title: "Originál a ořez se v názvu liší",
    description:
      "Pro nálezy s originálem i ořezem na disku má být název souborů (bez přípony) shodný. Krátká forma ořezu `<id>.jpg` se vynechává — je to záměrná zkratka.",
    offenders,
  };
}

/** readdir helper used by the cross-ref checks. Returns NFC-normalised
 *  names (filenames coming from rsync-from-macOS arrive in NFD on
 *  some paths; parseFindFilename normalises again internally, so the
 *  caller's compares stay consistent either way). Returns [] when
 *  the directory doesn't exist yet (ENOENT). */
async function readScopeFilenames(dir: string): Promise<string[]> {
  try {
    const names = await fs.readdir(dir);
    return names.filter((n) => !n.startsWith("."));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function runAllChecks(): Promise<CheckResult[]> {
  return Promise.all([
    checkFindsInAnonLocsNotAnon(),
    checkAnonFindsInPublicLoc(),
    checkFindsWithoutDate(),
    checkFindsWithoutGps(),
    checkOriginalsWithoutCrop(),
    checkMapCenterOutsidePolygon(),
    checkMultiplePrimaryImages(),
    checkFilenameNotInJson(),
    checkJsonNotInFilename(),
    checkOriginalCropFilenameMismatch(),
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
