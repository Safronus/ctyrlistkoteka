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

/**
 * Hard ceiling on a reassembled package. Raised from 2 GB when a ~25 000-find
 * package didn't fit; 4 GB is also the boundary above which ZIP64 becomes
 * mandatory, so staying at it avoids depending on the producer emitting a
 * valid ZIP64 (yauzl reads it, but we've never verified our own archives do).
 *
 * Nothing in the pipeline buffers the whole file — the browser sends 8 MB
 * chunks written at byte offsets (plain JS numbers, safe past any 32-bit
 * limit), analysis reads only entry names + the LSP JSON, and commit streams
 * entry-by-entry. The practical ceiling is disk: the temp ZIP, the staged
 * copies and the WebP that `sync` derives from them all coexist for a while.
 *
 * KNOWN LIMIT (2026-07-27, owner's call to leave it): commit is one blocking
 * request that writes every entry, and Nginx caps `/admin/` at
 * `proxy_read_timeout 300s`. A package with tens of thousands of files can
 * exceed that and surface as a 504 while the server keeps going. If that
 * happens, give `/admin/api/import/` its own location block with a long
 * timeout (deploy/nginx.conf.template) — it's a manual step, CI doesn't
 * deploy Nginx.
 */
export const MAX_IMPORT_ZIP_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB
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
