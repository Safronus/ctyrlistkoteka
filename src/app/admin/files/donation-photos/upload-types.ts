// Caps for the donation-photo upload endpoint. Smaller per-file budget
// than finds/crops because these are (typically) single-camera shots
// that don't need 25 MB of headroom — but we still allow up to 1000
// in the queue so a bulk import is one motion.

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 50;
export const MAX_QUEUE_FILES = 1000;

/** Per-batch byte cap. Mirrors the finds uploader: there's an
 *  empirical ~10 MB body-truncation cap somewhere between the
 *  browser and Next.js (nginx? OVH proxy? HTTP/2 stream buffering?
 *  not yet isolated). Symptom is "Body length mismatch: read N
 *  bytes, Content-Length said M" surfacing from busboy because the
 *  trailing ~1–2 MB of the multipart body never arrives. Keeping
 *  every batch below 8 MB leaves headroom for multipart framing
 *  overhead. Donation photos average ~3–8 MB each, so most batches
 *  will end up as 1–2 files; the form chunks the queue
 *  accordingly. */
export const MAX_BATCH_BYTES = 8 * 1024 * 1024;

export interface UploadResult {
  index: number;
  filename: string;
  status: "ok" | "rejected";
  reason?: string;
  size?: number;
  /** Find ID parsed from the filename (`<findId><slot>_DAR…`). */
  findId?: number;
  /** `a` / `b` / … — slot letter parsed from the filename. */
  slot?: string;
  /** True when the filename carried the optional `_ANON` token. */
  isAnonymized?: boolean;
}

/** Top-level response shape. Mirrors the finds upload route — `error`
 *  is set when the whole batch failed (parse error, auth, crash) and
 *  the form surfaces it in the banner without per-row processing. */
export interface UploadResponse {
  results: UploadResult[];
  error?: string;
}
