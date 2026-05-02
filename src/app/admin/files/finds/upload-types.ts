// Constants and types for the find-photo upload server action. Lives
// in a sibling file because "use server" modules may only export async
// functions — re-exporting plain values from the action breaks the
// client-side import.

/** Per-file size cap. Real prepare-upload JPEGs sit ~500 kB; the cap
 *  is set well above that so a slightly larger original isn't rejected
 *  but a runaway file can't blow through the request body limit on
 *  its own. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Hard limit on files in one server-action submit. The browser keeps
 *  the request open until the upload finishes; batching ~50 photos at
 *  ~500 kB each fits well inside the 200 MB request cap configured in
 *  next.config.ts and stays under any reasonable timeout. */
export const MAX_FILES_PER_REQUEST = 50;

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
