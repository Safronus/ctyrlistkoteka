// Caps for the location-photo upload action. Mirrors the donation
// variant — same per-file budget (single-camera shot), same queue cap.

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 50;
export const MAX_QUEUE_FILES = 1000;

export interface UploadResult {
  index: number;
  filename: string;
  status: "ok" | "rejected";
  reason?: string;
  size?: number;
  /** Map basename the photo binds to — the prefix before the
   *  `_reálné foto…` segment, sans extension. Helpful for the upload
   *  UI to show the user which map a row will be attached to. */
  mapBaseName?: string;
}
