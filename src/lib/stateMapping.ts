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
 *   LOKACE-NEEXISTUJE → LOCATION_GONE  (the location existed but is no
 *                                       longer there — distinct from
 *                                       BEZLOKACE = LOCATION_MISSING)
 *
 * Legacy transliterated tokens are kept as fallbacks so any historical
 * files that happen to have been through the old tooling still import.
 */
export const FILENAME_STATE_MAP: ReadonlyMap<string, FindState> = new Map([
  ["NORMÁLNÍ", FindState.NORMAL],
  ["BEZGPS", FindState.NO_GPS],
  ["BEZFOTKY", FindState.NO_PHOTO],
  ["DAROVANÝ", FindState.DONATED],
  ["DAROVANY", FindState.DONATED],
  ["LOKACE-NEEXISTUJE", FindState.LOCATION_GONE],
  // Legacy transliterated forms — kept for compatibility.
  ["NORMA_LNI_", FindState.NORMAL],
  ["DAROVANY_", FindState.DONATED],
  ["DAROVAN_", FindState.DONATED],
]);

/**
 * Mapping from JSON "stavy" keys to DB enum (docs/filename-convention.md, D).
 * JSON keys stay ASCII. BEZLOKACE keeps its meaning (no location at all);
 * LOKACE-NEEXISTUJE flips to the dedicated LOCATION_GONE enum so the UI
 * can distinguish "we never knew the location" from "the location is
 * physically gone".
 */
export const JSON_STATE_MAP: Readonly<Record<string, FindState>> = {
  BEZFOTKY: FindState.NO_PHOTO,
  BEZGPS: FindState.NO_GPS,
  BEZLOKACE: FindState.LOCATION_MISSING,
  DAROVANY: FindState.DONATED,
  "LOKACE-NEEXISTUJE": FindState.LOCATION_GONE,
  NEUTRZEN: FindState.NOT_PICKED,
  ZTRACENY: FindState.LOST,
};
