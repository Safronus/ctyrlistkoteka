// Constants and types for the crop-upload server action. Mirrors the
// finds/maps variants — see those for rationale; the caps are the
// same because crops are JPEGs of comparable size to find originals.

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 50;
export const MAX_QUEUE_FILES = 1000;

/** Per-batch byte cap. See finds/upload-types.ts for the rationale —
 *  empirical ~10 MB body truncation cap somewhere upstream of Next.js,
 *  so we keep batches comfortably below it. */
export const MAX_BATCH_BYTES = 8 * 1024 * 1024;

export interface UploadResult {
  index: number;
  filename: string;
  status: "ok" | "rejected";
  reason?: string;
  size?: number;
  /** Find ID parsed from the filename — crops share the find-photo
   *  filename convention (per `scripts/apply-watermark.ts`: "ORIG
   *  and CROP can share the same basename"). */
  findId?: number;
}

/** Top-level response shape — matches finds/upload-types.ts. The
 *  `error` channel surfaces failures that aren't tied to a single
 *  file (auth, request shape, post-success rerender crashes), which
 *  Next.js otherwise masks with a generic production wrapper when
 *  the action throws. */
export interface UploadResponse {
  results: UploadResult[];
  error?: string;
}
