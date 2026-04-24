import { FindState } from "@prisma/client";
import { FILENAME_STATE_PATTERNS } from "./stateMapping";

/**
 * Filename parser for find photos AND location maps.
 *
 * On disk the original "+"-separated format:
 *   {FIND_ID}+{MAP_NUMBER}+{LOCATION_CODE}+{STATE}+{ANON_FLAG}+{NOTE}.{ext}
 * has all "+" and diacritic letters replaced by "_". Because underscores
 * occur BOTH as field separators AND inside individual fields, we can't
 * naively split on "_".
 *
 * Strategy: positional regex. Anchors are reliable (FIND_ID digits, 5-digit
 * MAP_NUMBER, finite STATE alternation, NE|ANO anon flag) so the only
 * ambiguous field — LOCATION_CODE — is pinned on both sides.
 *
 * On any failure the parser returns { ok: false, error } with a short
 * machine-readable reason; callers log it to sync-failures.jsonl.
 */

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface ParsedFindFilename {
  findId: number;
  mapNumber: number;
  locationCodeTransliterated: string;
  state: FindState;
  /** True if filename's 5th field is ANO. NOT the final anonymization decision
   *  — that is JSON's "anonymizace.ANONYMIZOVANE" OR-ed with this flag. */
  isAnonymized: boolean;
  hasNote: boolean;
  /** Transliterated note text or null when filename says "BezPozna_mky". */
  noteTransliterated: string | null;
  extension: string;
}

export interface ParsedMapFilename {
  locationCodeTransliterated: string;
  descriptionTransliterated: string;
  centerLat: number;
  centerLng: number;
  zoom: number;
  mapId: number;
  extension: string;
}

const NO_NOTE_MARKER = "BezPozna_mky";

/**
 * Regex built from FILENAME_STATE_PATTERNS, longer alternations first.
 * Each pattern is RegExp-escaped (no metacharacters expected, but defensive).
 */
const STATE_ALTERNATION = FILENAME_STATE_PATTERNS.map((p) =>
  p.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
).join("|");

/**
 * Full find-photo name regex. Each field is captured.
 *
 *   ^(\d+)                     FIND_ID
 *   _(\d{5})                   MAP_NUMBER (5 digits, zero-padded)
 *   _(.+?)                     LOCATION_CODE (non-greedy, bounded below)
 *   _(<STATE_ALT>)             STATE
 *   _(NE|ANO)                  ANON flag
 *   (?:_(.*))?                 NOTE (optional)
 *   $
 *
 * The non-greedy (.+?) backtracks until the STATE alternative on its right
 * matches, guaranteeing the correct split even when LOCATION_CODE contains
 * underscores.
 */
const FIND_NAME_RE = new RegExp(
  "^(\\d+)_(\\d{5})_(.+?)_(" +
    STATE_ALTERNATION +
    ")_(NE|ANO)(?:_(.*))?$",
);

export function parseFindFilename(
  filename: string,
): ParseResult<ParsedFindFilename> {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) {
    return fail(`No file extension: "${filename}"`);
  }
  const name = filename.slice(0, dot);
  const extension = filename.slice(dot + 1);

  const m = FIND_NAME_RE.exec(name);
  if (!m) {
    return fail(`Filename does not match find-photo schema: "${filename}"`);
  }

  const [, findIdStr, mapNumStr, locCode, stateStr, anonFlag, noteRaw] = m;

  const statePattern = FILENAME_STATE_PATTERNS.find(
    (p) => p.pattern === stateStr,
  );
  if (!statePattern) {
    // Regex alternation matched, so this is unreachable barring a bug.
    return fail(`Unknown STATE token: "${stateStr}"`);
  }

  const noteTransliterated = noteRaw ?? null;
  const hasNote =
    noteTransliterated !== null && noteTransliterated !== NO_NOTE_MARKER;

  return ok({
    findId: Number(findIdStr),
    mapNumber: Number(mapNumStr),
    locationCodeTransliterated: locCode!,
    state: statePattern.state,
    isAnonymized: anonFlag === "ANO",
    hasNote,
    noteTransliterated: hasNote ? noteTransliterated : null,
    extension,
  });
}

/**
 * Map filename regex. Applied after stripping extension.
 *
 *   ^(LOCATION_CODE)_(DESCRIPTION)_GPS(lat)S_(lng)V_Z(zoom)_(MAP_ID)$
 *
 * LOCATION_CODE is matched separately (same cadastral_type_number[subpart]
 * shape as find photos). DESCRIPTION is then whatever's between the code
 * and the GPS anchor.
 */
const MAP_TAIL_RE =
  /^(?<rest>.+)_GPS(?<lat>\d+_\d+)S_(?<lng>\d+_\d+)V_Z(?<zoom>\d+)_(?<mapId>\d{5})$/;

/**
 * Regex matching the LOCATION_CODE prefix in a map/find name.
 * Greedy on the cadastral part so trailing underscores from diacritics
 * (e.g., "RATIBOR_" from "RATIBOŘ") are captured in the cadastral group.
 *
 *   cadastral: any chars, but ending right before the _TYPE boundary
 *   type:      run of uppercase letters
 *   number:    exactly 3 digits
 *   subpart:   0 or 1 lowercase letter
 */
const LOCATION_CODE_RE = /^(.+?)_([A-Z]+)(\d{3})([a-z]?)/;

export function parseMapFilename(
  filename: string,
): ParseResult<ParsedMapFilename> {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) {
    return fail(`No file extension: "${filename}"`);
  }
  const name = filename.slice(0, dot);
  const extension = filename.slice(dot + 1);

  const tail = MAP_TAIL_RE.exec(name);
  if (!tail || !tail.groups) {
    return fail(`Filename does not match map schema: "${filename}"`);
  }

  const { rest, lat, lng, zoom, mapId } = tail.groups;
  const centerLat = Number(lat!.replace("_", "."));
  const centerLng = Number(lng!.replace("_", "."));
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) {
    return fail(`Invalid GPS in map filename: "${filename}"`);
  }

  const codeMatch = LOCATION_CODE_RE.exec(rest!);
  if (!codeMatch) {
    return fail(`Could not find LOCATION_CODE in: "${filename}"`);
  }

  const locationCodeTransliterated = codeMatch[0];
  const descriptionTransliterated = rest!
    .slice(codeMatch[0].length)
    .replace(/^_/, "");

  return ok({
    locationCodeTransliterated,
    descriptionTransliterated,
    centerLat,
    centerLng,
    zoom: Number(zoom!),
    mapId: Number(mapId!),
    extension,
  });
}

/**
 * Convenience splitter for a LOCATION_CODE into its 4 components.
 * Works on either transliterated ("RATIBOR__POLE001f") or original
 * ("RATIBOŘ_POLE001f") input — treats any non-digit, non-lowercase tail as
 * part of the cadastral area.
 */
export interface LocationCodeParts {
  cadastralArea: string;
  locationType: string;
  number: number;
  subpart: string | null;
}

export function parseLocationCode(
  code: string,
): ParseResult<LocationCodeParts> {
  const m = /^(.+?)[_]?([A-Z]+)(\d{3})([a-z]?)$/.exec(code);
  if (!m) {
    return fail(`Invalid LOCATION_CODE: "${code}"`);
  }
  const cadastralArea = m[1]!.replace(/_+$/, "");
  return ok({
    cadastralArea,
    locationType: m[2]!,
    number: Number(m[3]),
    subpart: m[4] ? m[4] : null,
  });
}

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}
