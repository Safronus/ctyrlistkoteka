import { FindState } from "@/generated/prisma/enums";

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
 *   ZTRACENÝ          → LOST
 *   NEUTRŽEN          → NOT_PICKED
 *   BEZLOKACE         → LOCATION_MISSING
 *   LOKACE-NEEXISTUJE → LOCATION_GONE  (the location existed but is no
 *                                       longer there — distinct from
 *                                       BEZLOKACE = LOCATION_MISSING)
 *
 * Each token is registered both with and without diacritics — visitors
 * occasionally save files from systems that strip the háček/čárka, and
 * the JSON `stavy` mapping is also ASCII-only, so accepting both forms
 * keeps a filename consistent with whatever the JSON would have called
 * the same find. Legacy transliterated tokens are kept as fallbacks so
 * any historical files that happen to have been through the old tooling
 * still import.
 */
export const FILENAME_STATE_MAP: ReadonlyMap<string, FindState> = new Map([
  ["NORMÁLNÍ", FindState.NORMAL],
  ["BEZGPS", FindState.NO_GPS],
  ["BEZFOTKY", FindState.NO_PHOTO],
  ["DAROVANÝ", FindState.DONATED],
  ["DAROVANY", FindState.DONATED],
  ["ZTRACENÝ", FindState.LOST],
  ["ZTRACENY", FindState.LOST],
  ["NEUTRŽEN", FindState.NOT_PICKED],
  ["NEUTRZEN", FindState.NOT_PICKED],
  ["BEZLOKACE", FindState.LOCATION_MISSING],
  ["LOKACE-NEEXISTUJE", FindState.LOCATION_GONE],
  // Legacy transliterated forms — kept for compatibility.
  ["NORMA_LNI_", FindState.NORMAL],
  ["DAROVANY_", FindState.DONATED],
  ["DAROVAN_", FindState.DONATED],
]);

/**
 * Mapping from JSON "stavy" keys to DB enum (docs/filename-convention.md, D).
 * JSON keys stay ASCII.
 *
 * BEZLOKACE (LOCATION_MISSING) is **active again** — but with a new, precise
 * meaning: the find's real location is unknown, so it's parked on the special
 * NEZNÁMÁ default location (id/číslo 0, see UNKNOWN_LOCATION_ID). That is a
 * genuine state distinct from BEZGPS (a find can lack GPS yet have a known
 * location, and vice versa), which is why the old "poor duplicate of BEZGPS"
 * retirement no longer applies.
 *
 * LOKACE-NEEXISTUJE (LOCATION_GONE) and NEUTRZEN (NOT_PICKED) stay retired: a
 * gone location is conveyed by the `NEEXISTUJE-` code prefix / the v2
 * `is_cancelled` flag, and NOT_PICKED had no real LSP backing. Their leftover
 * assignments are still swept by the sync convergence pass (DEPRECATED_STATES
 * in scripts/sync.ts).
 */
export const JSON_STATE_MAP: Readonly<Record<string, FindState>> = {
  BEZFOTKY: FindState.NO_PHOTO,
  BEZGPS: FindState.NO_GPS,
  BEZLOKACE: FindState.LOCATION_MISSING,
  DAROVANY: FindState.DONATED,
  GIGANT: FindState.GIGANT,
  ZTRACENY: FindState.LOST,
};

/**
 * Retired JSON "stavy" keys — known, but intentionally no longer applied
 * (see the note above). The LSP JSON in the field still carries them, so
 * sync recognises them as *deprecated* and skips them silently, instead of
 * flagging them as `unknown_state_key` (which should mean a real typo). Any
 * existing DB assignment for the mapped enum is still swept by the sync
 * convergence pass (DEPRECATED_STATES in scripts/sync.ts).
 */
export const DEPRECATED_JSON_STATE_KEYS: ReadonlySet<string> = new Set([
  "LOKACE-NEEXISTUJE", // was LOCATION_GONE — now the location's own flag
  "NEUTRZEN", // was NOT_PICKED
]);
