import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * On-disk lookup for the optional "free" photos a find can have — extra
 * snapshots that don't fit the strict naming convention of the canonical
 * find originals (e.g. another angle, a context shot, a photo of the
 * spot where the clover was picked). Distinct from the donation-photo
 * gallery (`findPhotos.ts`, `_DAR` token) — these are always public,
 * never anonymized, and live in their own directory so the listings on
 * each admin scope don't bleed into each other.
 *
 * Filename convention:
 *
 *   `<findId><slot>_FOTO.<ext>`
 *
 * - `findId`  — numeric, no padding (e.g. `16330`).
 * - `slot`    — single lowercase letter `a`, `b`, `c`, … (one per photo).
 * - `_FOTO`   — required token marking the file as a free find photo.
 * - extension — jpg, jpeg, png, or webp. The admin upload action
 *               re-encodes large inputs to WebP, so most files on disk
 *               will end up as `.webp`.
 *
 * No `_ANON` variant: per the product decision the author only uploads
 * here what's safe to publish. If that ever changes the regex can grow
 * an `_ANON` capture group + the Nginx 404 rule can be widened.
 *
 * Workflow:
 *   1. Author picks photos in the find-detail admin card.
 *   2. Action assigns the next slot letter past whatever's already on
 *      disk, optionally resizes + re-encodes (>2 MB or >2400 px), and
 *      writes the file under the matching name.
 *   3. This module reads the directory at request time (5-min TTL) so
 *      a freshly uploaded photo appears on the public detail page on
 *      the next ISR render.
 */

const PHOTOS_SUBDIR = "find-free-photos";
const URL_PREFIX = "/generated/find-free-photos";
const ALLOWED_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const DIR_CACHE_TTL_MS = 5 * 60 * 1000;
const FILENAME_RE = /^(\d+)([a-z])_FOTO\.(jpe?g|png|webp)$/i;

export interface FindFreePhotoEntry {
  /** `a`, `b`, `c`, … — drives gallery sort order. */
  slot: string;
  /** Public URL of the photo. Never null — free photos have no ANON
   *  variant, so every entry resolves to a real URL. */
  url: string;
  /** Filename on disk (with extension). */
  filename: string;
}

interface DirCache {
  byFindId: Map<number, FindFreePhotoEntry[]>;
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
  const byFindId = new Map<number, FindFreePhotoEntry[]>();
  for (const name of entries) {
    // NFC-normalize before regex match — Mac → Linux rsync can decompose
    // accents on some paths. The filename pattern is ASCII so the
    // practical risk is low, but stays consistent with findPhotos.ts.
    const normalized = name.normalize("NFC");
    const m = FILENAME_RE.exec(normalized);
    if (!m) continue;
    const ext = path.extname(normalized).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) continue;
    const findId = Number(m[1]);
    if (!Number.isInteger(findId) || findId <= 0) continue;
    const slot = m[2]!.toLowerCase();
    const list = byFindId.get(findId) ?? [];
    list.push({
      slot,
      url: `${URL_PREFIX}/${encodeURIComponent(normalized)}`,
      filename: normalized,
    });
    byFindId.set(findId, list);
  }
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

/** Drops the in-memory directory index. Admin uploads/deletes call this
 *  so a freshly added photo appears on the next public render without
 *  waiting for the 5-min TTL or a process restart. */
export function invalidateFindFreePhotosCache(): void {
  dirCache = null;
}

/** Returns every free photo bound to a find (sorted by slot), or an
 *  empty array if none are present. */
export async function getFindFreePhotos(
  findId: number,
): Promise<FindFreePhotoEntry[]> {
  const cache = await getDirCache();
  return cache.byFindId.get(findId) ?? [];
}

/** Set of find IDs that have at least one free photo on disk. Used by
 *  the /sbirka listing to render the secondary gallery badge. */
export async function getFindIdsWithFreePhotos(): Promise<Set<number>> {
  const cache = await getDirCache();
  return new Set(cache.byFindId.keys());
}
