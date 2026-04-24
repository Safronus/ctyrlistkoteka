import { FindState } from "@prisma/client";

/**
 * Mapping from the STATE field of a find-photo filename to the DB enum.
 *
 * Real filenames preserve `+` separators and diacritics (the transliterated
 * convention documented earlier in docs/filename-convention.md describes
 * an older tool chain that is not what the user actually uses). The real
 * state tokens are:
 *   NORMÁLNÍ          → NORMAL
 *   BEZGPS            → NO_GPS
 *   BEZFOTKY          → NO_PHOTO
 *   DAROVANÝ          → DONATED
 *   LOKACE-NEEXISTUJE → LOCATION_MISSING
 *
 * Legacy transliterated tokens are kept as fallbacks so any historical
 * files that happen to have been through the old tooling still import.
 */
export const FILENAME_STATE_MAP: ReadonlyMap<string, FindState> = new Map([
  ["NORMÁLNÍ", FindState.NORMAL],
  ["BEZGPS", FindState.NO_GPS],
  ["BEZFOTKY", FindState.NO_PHOTO],
  ["DAROVANÝ", FindState.DONATED],
  ["LOKACE-NEEXISTUJE", FindState.LOCATION_MISSING],
  // Legacy transliterated forms — kept for compatibility.
  ["NORMA_LNI_", FindState.NORMAL],
  ["DAROVANY_", FindState.DONATED],
  ["DAROVAN_", FindState.DONATED],
]);

/**
 * Mapping from JSON "stavy" keys to DB enum (docs/filename-convention.md, D).
 * JSON keys stay ASCII (no diacritics). `BEZLOKACE` and `LOKACE-NEEXISTUJE`
 * both collapse to LOCATION_MISSING as documented.
 */
export const JSON_STATE_MAP: Readonly<Record<string, FindState>> = {
  BEZFOTKY: FindState.NO_PHOTO,
  BEZGPS: FindState.NO_GPS,
  BEZLOKACE: FindState.LOCATION_MISSING,
  DAROVANY: FindState.DONATED,
  "LOKACE-NEEXISTUJE": FindState.LOCATION_MISSING,
  NEUTRZEN: FindState.NOT_PICKED,
  ZTRACENY: FindState.LOST,
};
