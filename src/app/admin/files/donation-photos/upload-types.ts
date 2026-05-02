// Caps for the donation-photo upload action. Smaller per-file budget
// than finds/crops because these are (typically) single-camera shots
// that don't need 25 MB of headroom — but we still allow up to 1000
// in the queue so a bulk import is one motion.

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 50;
export const MAX_QUEUE_FILES = 1000;

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
