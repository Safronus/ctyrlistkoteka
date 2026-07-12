import { promises as fs } from "node:fs";
import path from "node:path";
import { ADMIN_ROOTS } from "./paths";

/**
 * Shared helpers for the "web package" (ZIP) bulk import. The archive is
 * uploaded from the browser in small chunks (dodging the ~10 MB multipart
 * body-truncation cap) and reassembled into a temp file under data/.admin/
 * import-tmp/. Nothing here touches the DB — the import stages files into the
 * same data/ dirs manual upload targets + merges the LSP JSON, then the
 * operator runs /admin/sync (which alone writes the DB + generates WebP).
 */

// UUID v4-ish, the shape crypto.randomUUID() produces on the client.
const UPLOAD_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Hard ceiling on a reassembled package (well above realistic hundreds of
 *  MB, below anything that could exhaust the box). */
export const MAX_IMPORT_ZIP_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
/** Per-chunk cap — the client sends ≤8 MB (MAX_BATCH_BYTES); allow a little
 *  slack, reject anything absurd. */
export const MAX_IMPORT_CHUNK_BYTES = 16 * 1024 * 1024;

const ADMIN_DIR = path.join(ADMIN_ROOTS.meta, "..", ".admin");

export function importTmpDir(): string {
  return path.join(ADMIN_DIR, "import-tmp");
}

export function isValidUploadId(id: unknown): id is string {
  return typeof id === "string" && UPLOAD_ID_RE.test(id);
}

/** Absolute path of an upload's reassembled temp ZIP. Throws on a bad id so
 *  a malformed id can never escape the temp dir. */
export function importZipPath(uploadId: string): string {
  if (!isValidUploadId(uploadId)) {
    throw new Error("Neplatné upload id.");
  }
  return path.join(importTmpDir(), `${uploadId}.zip`);
}

/** Removes an upload's temp ZIP + any per-upload extract dir. Swallows
 *  ENOENT — safe to call on cancel, success, or error. */
export async function cleanupImportUpload(uploadId: string): Promise<void> {
  if (!isValidUploadId(uploadId)) return;
  await fs
    .rm(importZipPath(uploadId), { force: true })
    .catch(() => undefined);
  await fs
    .rm(path.join(importTmpDir(), uploadId), { recursive: true, force: true })
    .catch(() => undefined);
}
