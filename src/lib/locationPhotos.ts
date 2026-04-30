import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * On-disk lookup for the optional "real photo" each location-map can have.
 *
 * Workflow (manual, outside `pnpm sync`):
 *  1. Author takes a real-life photo of the location with the AOI sketched
 *     on top.
 *  2. Author saves it as PNG into `${GENERATED_DIR}/location-photos/`,
 *     naming it the same as the location map's source filename WITHOUT
 *     extension, plus the suffix `_reálné foto*.png` (free trailing
 *     descriptor allowed — e.g. "…_reálné foto ve střední velikosti.png").
 *
 * Lookup path uses the `originalFilename` field on the locationMap (which
 * preserves diacritics + plus signs as the user typed them — the
 * `imagePath` column is sha1-hashed for cache-busting and isn't usable
 * for matching). The directory listing is cached for 5 minutes so a
 * fresh upload is picked up on the next ISR rerender without restarting
 * the process, while repeated detail renders inside that window stay
 * O(1) memory.
 */

const PHOTOS_SUBDIR = "location-photos";
const URL_PREFIX = "/generated/location-photos";
const PHOTO_SUFFIX_PREFIX = "_reálné foto";
const ALLOWED_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const DIR_CACHE_TTL_MS = 5 * 60 * 1000;

interface DirCache {
  /** Lower-case basename → exact filename on disk. We compare basenames
   *  case-insensitively because macOS HFS+ is case-insensitive by
   *  default and the user uploads from there; storing the exact name
   *  preserves case for the URL we hand to the browser. */
  byKey: Map<string, string>;
  loadedAt: number;
}

let dirCache: DirCache | null = null;

function getPhotosDir(): string {
  const generatedDir = process.env.GENERATED_DIR ?? "./public/generated";
  return path.join(generatedDir, PHOTOS_SUBDIR);
}

/** Normalize to NFC (canonical composed form) + lowercase. macOS APFS
 *  reports filenames as the user typed them, but rsync between an HFS+
 *  source and a Linux target can produce NFD (decomposed) on the Linux
 *  side. Without this, "REYKJAVÍK" stored NFC in the DB would byte-for-
 *  byte differ from "REYKJAVI<COMBINING ACUTE>K" on disk and the lookup
 *  would silently miss. NFC is also the form Next.js / Node uses
 *  internally, so this is a no-op for already-composed strings. */
function makeKey(s: string): string {
  return s.normalize("NFC").toLowerCase();
}

async function loadDirCache(): Promise<DirCache> {
  const dir = getPhotosDir();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    // Directory doesn't exist yet — treat as empty index, don't crash.
  }
  const byKey = new Map<string, string>();
  for (const name of entries) {
    const ext = path.extname(name).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) continue;
    // Strip extension first, then strip the `_reálné foto*` suffix to
    // recover the location-map's basename (the join key). The key is
    // NFC-normalized + lowercased so a Mac → Linux rsync with NFD
    // decomposition still matches the DB-stored originalFilename.
    const noExt = name.slice(0, name.length - ext.length);
    const normalized = noExt.normalize("NFC");
    const idx = normalized.indexOf(PHOTO_SUFFIX_PREFIX);
    if (idx <= 0) continue; // suffix must be present AND not at index 0
    const baseKey = normalized.slice(0, idx).toLowerCase();
    // First match wins — if the user accidentally has two photos for one
    // map, the alphabetically earliest one (readdir's natural order on
    // most filesystems) is rendered.
    if (!byKey.has(baseKey)) byKey.set(baseKey, name);
  }
  return { byKey, loadedAt: Date.now() };
}

async function getDirCache(): Promise<DirCache> {
  const now = Date.now();
  if (dirCache && now - dirCache.loadedAt < DIR_CACHE_TTL_MS) {
    return dirCache;
  }
  dirCache = await loadDirCache();
  return dirCache;
}

/**
 * Resolves the public URL of the real-life photo bound to a location
 * map, or null if there's no match. Anonymized maps short-circuit to
 * null — even if the file existed on disk we wouldn't surface it.
 */
export async function getLocationMapPhotoUrl(params: {
  originalFilename: string;
  isAnonymized: boolean;
}): Promise<string | null> {
  if (params.isAnonymized) return null;
  // Strip extension from `originalFilename` (e.g. ".HEIC" / ".jpg") so
  // the key matches the suffix-stripped on-disk basename. NFC + lower
  // mirrors the on-disk index — see makeKey() comment.
  const ext = path.extname(params.originalFilename);
  const baseKey = makeKey(
    params.originalFilename.slice(
      0,
      params.originalFilename.length - ext.length,
    ),
  );
  if (!baseKey) return null;
  const cache = await getDirCache();
  const filename = cache.byKey.get(baseKey);
  if (!filename) return null;
  // Encode every path segment — the filename can carry diacritics, plus
  // signs, and spaces, all of which need percent-encoding for the URL.
  return `${URL_PREFIX}/${encodeURIComponent(filename)}`;
}
