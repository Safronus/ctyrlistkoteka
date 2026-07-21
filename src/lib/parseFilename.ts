/**
 * Filename parser for find photos AND location maps.
 *
 * Real filenames keep `+` as the field separator AND preserve diacritics,
 * so parsing is just `split('+')` plus segment-level validation. The
 * LOCATION_CODE segment is treated as an opaque string — any downstream
 * decomposition happens in `splitLocationCode` in locationCode.ts.
 *
 * On failure we return `{ ok: false, error }` with a short reason so the
 * sync script can log it to sync-failures.jsonl. Parsing never throws.
 */

import { FindState } from "@/generated/prisma/enums";
import { FILENAME_STATE_MAP } from "./stateMapping";

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface ParsedFindFilename {
  findId: number;
  mapNumber: number;
  /** Raw location code — opaque, contains diacritics and optional spaces. */
  locationCode: string;
  state: FindState;
  /** Filename pole 5 = ANO. OR-ed with JSON.anonymizace in sync. */
  isAnonymized: boolean;
  hasNote: boolean;
  /** Raw note text (with diacritics) or null when filename says "BezPoznámky". */
  note: string | null;
  extension: string;
}

export interface ParsedMapFilename {
  locationCode: string;
  description: string;
  centerLat: number;
  centerLng: number;
  zoom: number;
  mapId: number;
  extension: string;
}

const NO_NOTE_MARKERS = new Set([
  "BezPoznámky",
  "BezPozna_mky", // legacy transliterated form
]);

export function parseFindFilename(
  filename: string,
): ParseResult<ParsedFindFilename> {
  // Normalize Unicode (filenames coming from macOS via rsync/scp arrive in
  // NFD form — "Á" as A + combining acute — which fails string equality
  // against our NFC-typed source-code constants like "NORMÁLNÍ").
  const nfc = filename.normalize("NFC");
  const dot = nfc.lastIndexOf(".");
  if (dot === -1) {
    return fail(`No file extension: "${filename}"`);
  }
  const name = nfc.slice(0, dot);
  const extension = nfc.slice(dot + 1);

  const parts = name.split("+");
  if (parts.length < 5) {
    return fail(
      `Expected at least 5 '+' segments, got ${parts.length}: "${filename}"`,
    );
  }

  const [findIdStr, mapNumStr, locCode, stateStr, anonFlag, ...noteParts] =
    parts;

  if (!/^\d+$/.test(findIdStr!)) {
    return fail(`FIND_ID must be numeric, got "${findIdStr}"`);
  }
  if (!/^\d{5}$/.test(mapNumStr!)) {
    return fail(`MAP_NUMBER must be 5 digits, got "${mapNumStr}"`);
  }

  const locationCode = locCode!.trim();
  if (!locationCode) {
    return fail(`LOCATION_CODE is empty`);
  }

  const state = FILENAME_STATE_MAP.get(stateStr!);
  if (!state) {
    return fail(`Unknown STATE token: "${stateStr}"`);
  }

  if (anonFlag !== "NE" && anonFlag !== "ANO") {
    return fail(`ANON_FLAG must be NE or ANO, got "${anonFlag}"`);
  }

  // Notes may themselves contain `+` (unlikely but legal in user land).
  // Rejoin trailing segments so we never silently drop data.
  const noteRaw = noteParts.length > 0 ? noteParts.join("+") : "";
  const hasNote =
    noteRaw.length > 0 && !NO_NOTE_MARKERS.has(noteRaw);

  return ok({
    findId: Number(findIdStr),
    mapNumber: Number(mapNumStr),
    locationCode,
    state,
    isAnonymized: anonFlag === "ANO",
    hasNote,
    note: hasNote ? noteRaw : null,
    extension,
  });
}

/**
 * Returns `filename` with its LOCATION_CODE segment (index 2) swapped for
 * `newCode`, or **null** when nothing should change — i.e. the name isn't a
 * full-form coded photo (short-form crops like `<id>.jpg` carry no code), or
 * the code already matches. Everything else — FIND_ID, the 5-digit
 * MAP_NUMBER, STATE, ANON_FLAG, the (possibly `+`-containing) note, and the
 * extension — is preserved verbatim. Both the input and `newCode` are
 * NFC-normalised so a rename never flips diacritic forms.
 *
 * This is the sync's Phase-E rename primitive: when a map package changes a
 * location's id_lokace, its find photos get the new code token here. The
 * join is by MAP_NUMBER, so this is purely cosmetic filename hygiene — but
 * it keeps disk / DB / JSON telling the same story.
 */
export function withNewLocationCode(
  filename: string,
  newCode: string,
): string | null {
  const nfc = filename.normalize("NFC");
  const dot = nfc.lastIndexOf(".");
  if (dot === -1) return null;
  const name = nfc.slice(0, dot);
  const ext = nfc.slice(dot); // includes the leading dot
  const parts = name.split("+");
  if (parts.length < 5) return null; // short-form / not a coded photo
  const next = newCode.normalize("NFC");
  if (parts[2] === next) return null; // already current — no rename
  parts[2] = next;
  return parts.join("+") + ext;
}

export function parseMapFilename(
  filename: string,
): ParseResult<ParsedMapFilename> {
  const nfc = filename.normalize("NFC");
  const dot = nfc.lastIndexOf(".");
  if (dot === -1) {
    return fail(`No file extension: "${filename}"`);
  }
  const name = nfc.slice(0, dot);
  const extension = nfc.slice(dot + 1);

  const parts = name.split("+");
  if (parts.length !== 6) {
    return fail(
      `Map expected 6 '+' segments, got ${parts.length}: "${filename}"`,
    );
  }

  const [code, description, latSeg, lngSeg, zoomSeg, mapIdSeg] = parts;

  const locationCode = code!.trim();
  if (!locationCode) {
    return fail(`LOCATION_CODE is empty`);
  }

  const centerLat = parseLatitude(latSeg!);
  if (centerLat === null) {
    return fail(`Invalid latitude segment: "${latSeg}"`);
  }

  const centerLng = parseLongitude(lngSeg!);
  if (centerLng === null) {
    return fail(`Invalid longitude segment: "${lngSeg}"`);
  }

  const zoomMatch = /^Z(\d+)$/.exec(zoomSeg!);
  if (!zoomMatch) {
    return fail(`Invalid zoom segment: "${zoomSeg}"`);
  }
  const zoom = Number(zoomMatch[1]);

  if (!/^\d{5}$/.test(mapIdSeg!)) {
    return fail(`MAP_ID must be 5 digits, got "${mapIdSeg}"`);
  }

  return ok({
    locationCode,
    description: description!.trim(),
    centerLat,
    centerLng,
    zoom,
    mapId: Number(mapIdSeg),
    extension,
  });
}

/**
 * Parses the latitude segment "GPS{number}{S|J}".
 *   S = sever (north) → positive
 *   J = jih  (south)  → negative
 */
function parseLatitude(segment: string): number | null {
  const m = /^GPS(\d+(?:\.\d+)?)([SJ])$/.exec(segment);
  if (!m) return null;
  const abs = Number(m[1]);
  if (!Number.isFinite(abs)) return null;
  return m[2] === "J" ? -abs : abs;
}

/**
 * Parses the longitude segment "{number}{V|Z}".
 *   V = východ (east) → positive
 *   Z = západ  (west) → negative (e.g. Dublin, Reykjavík)
 */
function parseLongitude(segment: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([VZ])$/.exec(segment);
  if (!m) return null;
  const abs = Number(m[1]);
  if (!Number.isFinite(abs)) return null;
  return m[2] === "Z" ? -abs : abs;
}

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}
