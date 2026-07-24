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
 * BEZLOKACE (LOCATION_MISSING) is intentionally NOT here: it is NOT driven by
 * a stavy key or a filename token. Instead sync DERIVES it from the location —
 * every find parked on the special NEZNÁMÁ location (id 0, UNKNOWN_LOCATION_ID)
 * gets LOCATION_MISSING (see scripts/sync.ts). The state itself is active
 * (labelled + filterable — not in RETIRED_STATES); only its *source* is the
 * location link, not the JSON.
 *
 * LOKACE-NEEXISTUJE (LOCATION_GONE) and NEUTRZEN (NOT_PICKED) stay retired: a
 * gone location is the v2 `is_cancelled` flag, and NOT_PICKED had no real LSP
 * backing. Leftover assignments are swept by the sync convergence pass
 * (DEPRECATED_STATES in scripts/sync.ts).
 */
export const JSON_STATE_MAP: Readonly<Record<string, FindState>> = {
  BEZFOTKY: FindState.NO_PHOTO,
  BEZGPS: FindState.NO_GPS,
  DAROVANY: FindState.DONATED,
  GIGANT: FindState.GIGANT,
  ZTRACENY: FindState.LOST,
};

/**
 * Retired JSON "stavy" keys — known, but intentionally no longer applied
 * (see the note above). The LSP JSON in the field still carries them, so
 * sync recognises them as *deprecated* and skips them silently, instead of
 * flagging them as `unknown_state_key` (which should mean a real typo).
 *
 * BEZLOKACE is here so a stray `stavy.BEZLOKACE` in a hand-edited JSON is
 * ignored, NOT applied — LOCATION_MISSING comes solely from the location
 * link (a find on location 0), never from the JSON.
 */
export const DEPRECATED_JSON_STATE_KEYS: ReadonlySet<string> = new Set([
  "BEZLOKACE", // LOCATION_MISSING is derived from location 0, not the JSON
  "LOKACE-NEEXISTUJE", // was LOCATION_GONE — now the v2 is_cancelled flag
  "NEUTRZEN", // was NOT_PICKED
]);
