import { FindState } from "@prisma/client";

/**
 * Mapping from transliterated filename STATE field to DB enum.
 *
 * Per docs/filename-convention.md the pattern after transliteration is:
 *   NORMÁLNÍ  → NORMA_LNI_
 *   DAROVANÝ  → DAROVAN_   (or DAROVANY_ depending on Ý rule; we accept both)
 *   BEZGPS    → BEZGPS
 *   BEZFOTKY  → BEZFOTKY
 *
 * Order matters for regex alternation: longer patterns first so DAROVANY_
 * is tried before DAROVAN_.
 */
export const FILENAME_STATE_PATTERNS: ReadonlyArray<{
  pattern: string;
  state: FindState;
}> = [
  { pattern: "NORMA_LNI_", state: FindState.NORMAL },
  { pattern: "DAROVANY_", state: FindState.DONATED },
  { pattern: "DAROVAN_", state: FindState.DONATED },
  { pattern: "BEZFOTKY", state: FindState.NO_PHOTO },
  { pattern: "BEZGPS", state: FindState.NO_GPS },
];

/**
 * Mapping from JSON "stavy" keys to DB enum (docs/filename-convention.md, D).
 * Some keys intentionally map to the same enum:
 *   BEZLOKACE          → LOCATION_MISSING
 *   LOKACE-NEEXISTUJE  → LOCATION_MISSING (sjednoceno)
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
