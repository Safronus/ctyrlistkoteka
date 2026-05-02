import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * On-disk lookup for the optional "real-life" donation photos a find can
 * have (typically a card or photo handed over with the donated clover).
 * Mirrors `locationPhotos.ts` in shape — TTL-cached directory listing,
 * NFC-normalized lookup keys — but the filename convention is different:
 * one find can have several photos (front + back + ...).
 *
 * Filename convention:
 *
 *   `<findId><slot>_DAR[_ANON].<ext>`
 *
 * - `findId`  — numeric, no padding (e.g. `16330`)
 * - `slot`    — single lowercase letter `a`, `b`, `c`, … (one per photo)
 * - `_DAR`    — required token marking the photo as a donation photo
 * - `_ANON`   — optional, marks the photo as anonymized; the file lives on
 *               disk but the public URL is never exposed (Nginx 404s the
 *               file via a regex location, see deploy/nginx.conf.template).
 *               The detail-page modal renders a placeholder until the
 *               visitor types the unlock code (server action verifies and
 *               returns base64 data URLs).
 * - extension — jpg, jpeg, png, or webp.
 *
 * Examples:
 *   `16330a_DAR.jpeg`        — first photo, public.
 *   `16330b_DAR.jpeg`        — second photo, public.
 *   `16330a_DAR_ANON.jpeg`   — first photo, anonymized (placeholder).
 *
 * Workflow:
 *   1. Author photographs the donated clover / card (front + back) and
 *      saves the files into `${GENERATED_DIR}/find-photos/`.
 *   2. Sync isn't involved — this helper reads the directory at request
 *      time (cached for 5 minutes) so a fresh upload appears after the
 *      next ISR rerender + `pm2 restart`.
 */

const PHOTOS_SUBDIR = "find-photos";
const URL_PREFIX = "/generated/find-photos";
const ALLOWED_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const DIR_CACHE_TTL_MS = 5 * 60 * 1000;
const FILENAME_RE = /^(\d+)([a-z])_DAR(_ANON)?\.(jpe?g|png|webp)$/i;

export interface FindPhotoEntry {
  /** `a`, `b`, `c`, … — drives gallery sort order so the front of the
   *  card consistently shows up before the back. */
  slot: string;
  isAnonymized: boolean;
  /** Public URL of the photo. `null` for ANON entries — Nginx 404s the
   *  file by name and the client-side modal swaps in a placeholder.
   *  After the visitor types the unlock code, a server action returns a
   *  one-shot base64 data URL that's used in place of `null`. */
  url: string | null;
  /** Filename on disk (with extension). Kept around so the unlock
   *  server action can read the bytes without walking the dir again. */
  filename: string;
}

interface DirCache {
  /** find id → sorted entries (alphabetical by slot). */
  byFindId: Map<number, FindPhotoEntry[]>;
  loadedAt: number;
}

let dirCache: DirCache | null = null;

function getPhotosDir(): string {
  const generatedDir = process.env.GENERATED_DIR ?? "./public/generated";
  return path.join(generatedDir, PHOTOS_SUBDIR);
}

async function loadDirCache(): Promise<DirCache> {
  const dir = getPhotosDir();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const byFindId = new Map<number, FindPhotoEntry[]>();
  for (const name of entries) {
    // NFC-normalize before regex match — Mac → Linux rsync can decompose
    // accents on some paths. Filename pattern is ASCII so the practical
    // risk is low, but the helper stays consistent with locationPhotos.
    const normalized = name.normalize("NFC");
    const m = FILENAME_RE.exec(normalized);
    if (!m) continue;
    const ext = path.extname(normalized).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) continue;
    const findId = Number(m[1]);
    if (!Number.isInteger(findId) || findId <= 0) continue;
    const slot = m[2]!.toLowerCase();
    const isAnonymized = m[3] !== undefined;
    const list = byFindId.get(findId) ?? [];
    list.push({
      slot,
      isAnonymized,
      url: isAnonymized
        ? null
        : `${URL_PREFIX}/${encodeURIComponent(normalized)}`,
      filename: normalized,
    });
    byFindId.set(findId, list);
  }
  // Sort each find's photos by slot — alphabetical so "a" (front) comes
  // before "b" (back) in the gallery carousel.
  for (const list of byFindId.values()) {
    list.sort((a, b) => a.slot.localeCompare(b.slot));
  }
  return { byFindId, loadedAt: Date.now() };
}

async function getDirCache(): Promise<DirCache> {
  const now = Date.now();
  if (dirCache && now - dirCache.loadedAt < DIR_CACHE_TTL_MS) {
    return dirCache;
  }
  dirCache = await loadDirCache();
  return dirCache;
}

/** Drops the in-memory directory index. Admin uploads/deletes call
 *  this so a freshly added photo shows up on the next public page
 *  render without waiting for the 5-min TTL or a process restart. */
export function invalidateFindPhotosCache(): void {
  dirCache = null;
}

/**
 * Returns every photo bound to a find (sorted by slot), or an empty
 * array if none are present. Public-only fields — ANON entries carry
 * `url: null` and the caller must render a placeholder. The on-disk
 * filename is included so the unlock server action can read bytes
 * without re-walking the directory.
 */
export async function getFindPhotos(
  findId: number,
): Promise<FindPhotoEntry[]> {
  const cache = await getDirCache();
  return cache.byFindId.get(findId) ?? [];
}

/**
 * Set of find IDs that have at least one donation photo on disk. Used
 * by the /sbirka list to decorate the camera badge + by /sbirka filter
 * `?hasPhoto=1` to keep only those rows. Computed once per cache
 * window so big paginated lists don't pay per-row I/O.
 */
export async function getFindIdsWithRealPhotos(): Promise<Set<number>> {
  const cache = await getDirCache();
  return new Set(cache.byFindId.keys());
}

/** Server-side helper for the unlock action — returns the absolute disk
 *  path of an ANON photo for the given find/slot, or null if no match.
 *  Lives in the same module so the dir-cache index is reused; the
 *  caller bears responsibility for verifying the unlock code. */
export async function resolveAnonPhotoPath(
  findId: number,
  slot: string,
): Promise<{ path: string; filename: string } | null> {
  const cache = await getDirCache();
  const entries = cache.byFindId.get(findId);
  if (!entries) return null;
  const entry = entries.find((e) => e.slot === slot && e.isAnonymized);
  if (!entry) return null;
  return {
    path: path.join(getPhotosDir(), entry.filename),
    filename: entry.filename,
  };
}
