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

import { FindState } from "@prisma/client";
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
  const dot = filename.lastIndexOf(".");
  if (dot === -1) {
    return fail(`No file extension: "${filename}"`);
  }
  const name = filename.slice(0, dot);
  const extension = filename.slice(dot + 1);

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

export function parseMapFilename(
  filename: string,
): ParseResult<ParsedMapFilename> {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) {
    return fail(`No file extension: "${filename}"`);
  }
  const name = filename.slice(0, dot);
  const extension = filename.slice(dot + 1);

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
