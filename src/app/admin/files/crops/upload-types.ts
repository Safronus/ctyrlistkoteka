// Constants and types for the crop-upload server action. Mirrors the
// finds/maps variants — see those for rationale; the caps are the
// same because crops are JPEGs of comparable size to find originals.

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 50;
export const MAX_QUEUE_FILES = 1000;

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
