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
  /** Map number (MAP_ID = the trailing 5-digit run of the map's basename)
   *  → exact filename on disk. Keyed by number rather than full basename
   *  because the v1→v2 migration RENAMED the map files (v2 nested Nosná
   *  basenames), which broke the old full-basename match — but the MAP_ID
   *  at the end of the name is invariant, and both the photo filename and
   *  the map's `originalFilename` carry it. Storing the exact filename
   *  preserves case/diacritics for the URL we hand to the browser. */
  byMapId: Map<number, string>;
  loadedAt: number;
}

/** MAP_ID from a map/photo basename stem — the trailing 5-digit run
 *  (…+00025 → 25). Mirror of scopes.ts `extractMapId`, kept local so this
 *  public-query module doesn't pull the fs-heavy admin scopes in. */
function extractMapNumber(stem: string): number | null {
  const m = /(?:^|[^0-9])(\d{5})$/.exec(stem);
  return m ? Number(m[1]) : null;
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
    // Directory doesn't exist yet — treat as empty index, don't crash.
  }
  const byMapId = new Map<number, string>();
  for (const name of entries) {
    const ext = path.extname(name).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) continue;
    // Strip extension, then the `_reálné foto*` suffix to recover the
    // location-map's basename, then pull its trailing MAP_ID — the stable
    // join key (the full basename changed in the v1→v2 rename).
    const noExt = name.slice(0, name.length - ext.length);
    const normalized = noExt.normalize("NFC");
    const idx = normalized.indexOf(PHOTO_SUFFIX_PREFIX);
    if (idx <= 0) continue; // suffix must be present AND not at index 0
    const stem = normalized.slice(0, idx);
    const mapId = extractMapNumber(stem);
    if (mapId === null) continue; // stem doesn't end in a MAP_ID → skip
    // First match wins — if two photos share a MAP_ID, the alphabetically
    // earliest one (readdir's natural order on most filesystems) is rendered.
    if (!byMapId.has(mapId)) byMapId.set(mapId, name);
  }
  return { byMapId, loadedAt: Date.now() };
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
export function invalidateLocationPhotosCache(): void {
  dirCache = null;
}

/**
 * Returns the set of map-basename keys (NFC-lower) that currently have
 * a real photo on disk. Equivalent to running `resolveLocationMapPhoto`
 * for every map and collecting which ones matched, but does the work
 * in O(directory size) instead of O(maps) — fine for the /admin/files/maps
 * listing which decorates ~130 rows per page.
 *
 * Does NOT honour `isAnonymized`: the listing wants to surface
 * "photo file exists for this map" even for anonymized maps so the
 * user can spot suppressed-on-public photos.
 */
export async function getRealPhotoMapIds(): Promise<ReadonlySet<number>> {
  const cache = await getDirCache();
  // Keys are MAP_IDs — callers check membership by the map's own číslo.
  return new Set(cache.byMapId.keys());
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
  const entry = await resolveLocationMapPhoto(params);
  return entry?.url ?? null;
}

/**
 * Admin-side variant of {@link getLocationMapPhotoUrl} that also yields
 * the on-disk filename, so the map detail page can deep-link into the
 * real-photo's own detail (`/admin/files/location-photos/<name>`) and
 * the upload action can decide whether to refuse a duplicate. The
 * `isAnonymized` flag is honoured: anonymized maps never expose their
 * real photo URL, even though the on-disk file may still exist.
 */
export async function resolveLocationMapPhoto(params: {
  originalFilename: string;
  isAnonymized: boolean;
}): Promise<{ filename: string; url: string } | null> {
  if (params.isAnonymized) return null;
  // Match by the map's MAP_ID (the trailing 5-digit run of its basename),
  // not the full basename — the v1→v2 rename changed the basename but not
  // the číslo, which both the map and its photo file still carry.
  const ext = path.extname(params.originalFilename);
  const stem = params.originalFilename
    .slice(0, params.originalFilename.length - ext.length)
    .normalize("NFC");
  const mapId = extractMapNumber(stem);
  if (mapId === null) return null;
  const cache = await getDirCache();
  const filename = cache.byMapId.get(mapId);
  if (!filename) return null;
  // Encode every path segment — the filename can carry diacritics, plus
  // signs, and spaces, all of which need percent-encoding for the URL.
  return {
    filename,
    url: `${URL_PREFIX}/${encodeURIComponent(filename)}`,
  };
}
