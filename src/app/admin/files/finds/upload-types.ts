// Constants and types for the find-photo upload server action. Lives
// in a sibling file because "use server" modules may only export async
// functions — re-exporting plain values from the action breaks the
// client-side import.

/** Per-file size cap. Real prepare-upload JPEGs sit ~500 kB; the cap
 *  is set well above that so a slightly larger original isn't rejected
 *  but a runaway file can't blow through the request body limit on
 *  its own. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Hard limit on files in one POST batch. Stays well below busboy's
 *  default file-count limit; the per-batch size cap below is the
 *  binding one in practice for a normal photo workflow. */
export const MAX_FILES_PER_REQUEST = 50;

/** Per-batch byte cap for the upload form. Stays below the empirical
 *  ~10 MB body-truncation cap somewhere between the browser and
 *  Next.js — could be nginx, an OVH proxy layer, or HTTP/2 stream
 *  buffering, but we don't know exactly which yet, so the safe move
 *  is to keep every batch comfortably below it. The form accumulates
 *  files into a batch until either MAX_FILES_PER_REQUEST or this
 *  total size is hit, whichever comes first. */
export const MAX_BATCH_BYTES = 8 * 1024 * 1024;

/** Maximum size of the client-side queue. The user can drop up to
 *  this many JPEGs at once; the form chunks them into
 *  MAX_FILES_PER_REQUEST-sized batches and uploads sequentially.
 *  Bumping this is cheap (no server-side memory pressure because
 *  each request still tops out at the per-batch cap), the only cost
 *  is total wall time for the whole queue. */
export const MAX_QUEUE_FILES = 1000;

export interface UploadResult {
  /** 0-based position in the original FormData entries — lets the
   *  client zip results back even if the filename was sanitised away
   *  from the original. */
  index: number;
  /** The on-disk basename when the file was accepted, otherwise the
   *  closest non-rejected approximation (post safeBaseName) so the UI
   *  can still display *something* recognisable. */
  filename: string;
  status: "ok" | "rejected";
  /** Present on rejections — short Czech reason rendered to the user
   *  next to the failed row. */
  reason?: string;
  /** Present on ok results — final on-disk byte length. */
  size?: number;
  /** Present on ok results — find ID parsed from the filename. */
  findId?: number;
}

/** Top-level response shape for the upload server action. The
 *  `error` field carries failures that aren't tied to a single file
 *  — auth, request-shape rejections, cookie/session crashes, the
 *  `revalidatePath` re-render blowing up. We return the message
 *  instead of `throw`-ing because Next.js masks server-action errors
 *  with a generic "Server Components render" wrapper in production
 *  builds, which hides the actual cause from the client. Returning
 *  a structured shape lets the form render the real reason. */
export interface UploadResponse {
  results: UploadResult[];
  error?: string;
}
