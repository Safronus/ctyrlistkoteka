// Constants and types for the location-map upload server action.
// Mirrors the finds/ variant — see that file for rationale notes; the
// caps are reused 1:1 because maps are smaller than find originals
// and the size/queue ceilings already had headroom there.

/** Per-file size cap. Real location maps are 100-500 kB JPEGs (with
 *  a .png extension); 25 MB is wildly above that and serves only as
 *  a runaway-input guard. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Server-side per-batch cap. Client splits a larger queue into
 *  batches of this size and submits sequentially. */
export const MAX_FILES_PER_REQUEST = 50;

/** Client queue ceiling. Maps top out around 128 entries on the live
 *  collection so 1000 is mostly nominal but stays in line with the
 *  finds/ pipeline. */
export const MAX_QUEUE_FILES = 1000;

export interface UploadResult {
  index: number;
  filename: string;
  status: "ok" | "rejected";
  reason?: string;
  size?: number;
  /** Map ID parsed from the last filename segment — used as the row
   *  badge when the upload succeeds. */
  mapId?: number;
  /** Location code parsed from the first filename segment. */
  locationCode?: string;
}
