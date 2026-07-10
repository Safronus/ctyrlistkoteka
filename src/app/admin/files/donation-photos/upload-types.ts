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

// ─── Bulk shared-photo assignment ─────────────────────────────────────────
// Upload a few real donation photos ONCE and link them to a whole range of
// finds (a voucher covering N clovers), instead of N physical copies.

/** Photos per bulk request (slots a…). A donation card is front/back-ish. */
export const MAX_BULK_PHOTOS = 12;
/** Find ids per bulk request — bounds the DB `IN` query + manifest write. */
export const MAX_BULK_FINDS = 2000;

/** Per-photo result of the chunked staging upload (step 1 of the bulk flow:
 *  normalize + park in staging, before the tiny JSON assign in step 2). */
export interface SharedUploadResult {
  index: number;
  filename: string;
  status: "ok" | "rejected";
  reason?: string;
  /** sha1 of the original bytes — the id the assign step references. */
  sha1?: string;
  sourceFormat?: string;
  /** True when the photo was already staged (dedup). */
  reused?: boolean;
}

export interface SharedUploadResponse {
  results: SharedUploadResult[];
  error?: string;
}

/** JSON body of the assign step — no file bytes, so it can't truncate. */
export interface BulkAssignRequest {
  /** sha1s of already-staged photos, in slot order (a, b, c…). */
  sha1s: string[];
  range: string;
  anon: boolean;
  overwrite: boolean;
}

export interface BulkAssignPhoto {
  slot: string;
  sha1: string;
  /** True when the served shared file already existed (dedup — nothing new
   *  was written promoting this photo). */
  reused: boolean;
}

export interface BulkCollision {
  findId: number;
  slot: string;
  /** `manifest` — an existing shared link (overwritable); `file` — a
   *  per-find photo file (never shadowed, always kept). */
  kind: "manifest" | "file";
}

export interface BulkAssignResponse {
  /** False when the request was a collision preview (nothing written) or
   *  failed validation; true once links were committed. */
  applied: boolean;
  /** Whole-batch failure (auth, parse, no valid ids, un-decodable photo). */
  error?: string;
  photos?: BulkAssignPhoto[];
  /** Range ids that exist in the DB — the assignment targets. */
  targetFindIds?: number[];
  /** Range ids not in the DB — reported, never assigned. */
  unknownFindIds?: number[];
  /** Slot collisions. With `overwrite=0` any collision makes the request a
   *  no-op preview (`applied:false`) so the operator can review + resubmit. */
  collisions?: BulkCollision[];
  /** (findId, slot) kept because a per-find FILE already occupies it — files
   *  are never shadowed by a shared link, even with overwrite. */
  keptOwnFile?: BulkCollision[];
  /** Count of (findId, slot) links written to the manifest. */
  assignedLinks?: number;
}
