// Caps for the free-photo upload action. Larger per-file budget than
// donation photos because the input is "whatever the camera produced"
// — the server-side conversion (>2 MB or >2400 px → WebP q82, max
// 2400 px on the long side) trims it down before write. Without that
// pre-shrink the dir would balloon over time.

export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 50;
export const MAX_QUEUE_FILES = 1000;

/** Conversion thresholds — when EITHER applies, sharp re-encodes the
 *  upload to WebP @q82 and resizes the long side down to MAX_LONG_PX.
 *  Smaller inputs are written verbatim (mtime preserved). */
export const CONVERT_BYTE_THRESHOLD = 2 * 1024 * 1024;
export const CONVERT_LONG_SIDE_PX = 2400;
export const WEBP_QUALITY = 82;
export const MAX_LONG_PX = 2400;

export interface UploadResult {
  index: number;
  /** Final on-disk basename (`<findId><slot>_FOTO.<ext>`). */
  filename: string;
  status: "ok" | "rejected";
  reason?: string;
  /** Size on disk after optional conversion. */
  size?: number;
  /** Find ID parsed from the filename. Set on `ok` results. */
  findId?: number;
  /** Slot letter assigned by the server (a, b, c …). Set on `ok`. */
  slot?: string;
  /** True when the server re-encoded the input to WebP. */
  converted?: boolean;
}
