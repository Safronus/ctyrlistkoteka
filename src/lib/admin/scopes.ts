import { promises as fs } from "node:fs";
import path from "node:path";
import { ADMIN_ROOTS, type AdminRootKey, safeJoin } from "./paths";
import { resolveV2MapFileByName } from "./mapsV2";

/** Resolves a requested filename to its actual on-disk basename
 *  inside the given root, accounting for Unicode normalization drift
 *  (the rsync-from-macOS NFD vs the browser-normalised NFC mismatch
 *  documented in MEMORY/project_filename_unicode_nfc.md). Returns the
 *  absolute path + the disk-form name on hit, null on miss.
 *
 *  Used as the single source of truth for "does this file exist
 *  under this scope root?" — both the file streaming endpoint, the
 *  upload existence check, and the delete actions go through it, so
 *  duplicate detection and rename-target lookup behave identically.
 *
 *  Fast path is a byte-exact `fs.access`; the slow path (NFC-aware
 *  directory scan) only runs on miss. Throws via `safeJoin` on path
 *  traversal so callers can map that to a 400/404 as appropriate. */
export async function resolveDiskPath(
  rootKey: AdminRootKey,
  requestedName: string,
): Promise<{ name: string; absolutePath: string } | null> {
  const root = ADMIN_ROOTS[rootKey];
  const direct = safeJoin(rootKey, requestedName);
  const baseName = path.basename(direct);

  // lstat (not access) so we also see whether the leaf is a SYMLINK: a
  // planted `data/finds/evil -> /etc/passwd` would otherwise be followed
  // by the subsequent read/copy and leak an out-of-tree file. Our paths
  // are always <root>/<basename> (safeBaseName forbids separators), so the
  // leaf is the only attacker-influenced component; lstat still follows
  // ancestor symlinks (e.g. a data root that lives on another mount) to
  // reach it, so a legitimately symlinked root is unaffected. Refusal
  // throws — callers already map resolveDiskPath throws to 404.
  const directStat = await fs.lstat(direct).catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  });
  if (directStat) {
    if (directStat.isSymbolicLink()) {
      throw new Error(`resolveDiskPath: refusing symlink '${direct}'`);
    }
    return { name: baseName, absolutePath: direct };
  }

  const requestedNFC = baseName.normalize("NFC");
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const match = names.find((n) => n.normalize("NFC") === requestedNFC);
  if (!match) return null;
  const matchAbs = path.join(root, match);
  // Same symlink guard on the NFC-resolved leaf.
  if ((await fs.lstat(matchAbs)).isSymbolicLink()) {
    throw new Error(`resolveDiskPath: refusing symlink '${matchAbs}'`);
  }
  return { name: match, absolutePath: matchAbs };
}

/** URL-friendly slugs admin pages use to refer to a scope. Must stay
 *  stable over time — they appear in routes, query params, and the
 *  audit log. Mapped → AdminRootKey at the file boundary. */
export type ScopeSlug =
  | "finds"
  | "crops"
  | "maps"
  | "meta"
  | "donation-photos"
  | "free-photos"
  | "location-photos";

interface ScopeDef {
  slug: ScopeSlug;
  rootKey: AdminRootKey;
  /** Human label for the navigation/cards (CS). */
  label: string;
  /** Single-line description shown on the file picker landing. */
  description: string;
  /** True when admin write operations are allowed in this scope.
   *  Phase 2 is read-only across the board, but the flag goes here
   *  so phase 3+ can flip values on without scattering rules. */
  writable: boolean;
}

export const SCOPES: readonly ScopeDef[] = [
  {
    slug: "finds",
    rootKey: "findOriginals",
    label: "Originály nálezů",
    description: "data/finds/ — celé fotky čtyřlístků (JPEG).",
    writable: true,
  },
  {
    slug: "crops",
    rootKey: "findCrops",
    label: "Výřezy nálezů",
    description:
      "data/crops/ — vyřezané čtyřlístky (JPEG). Akceptuje i zkrácený \"<id>.jpg\".",
    writable: true,
  },
  {
    slug: "maps",
    rootKey: "locationMaps",
    label: "Lokační mapy",
    description:
      "data/maps/ — mapy lokalit verze 2 (manifest.json + Nosné mapy/). Přehled; spravují se přes /admin/import.",
    writable: true,
  },
  {
    slug: "donation-photos",
    rootKey: "donationPhotos",
    label: "Reálné fotky darů",
    description:
      "generated/find-photos/ — fotky darů (např. \"16330a_DAR.jpeg\").",
    writable: true,
  },
  {
    slug: "free-photos",
    rootKey: "freePhotos",
    label: "Volné fotky nálezů",
    description:
      "generated/find-free-photos/ — další fotky nálezu (např. \"16330a_FOTO.webp\").",
    writable: true,
  },
  {
    slug: "location-photos",
    rootKey: "locationPhotos",
    label: "Reálné fotky lokalit",
    description:
      "generated/location-photos/ — fotky lokalit (např. \"Reykjavík_reálné foto.png\").",
    writable: true,
  },
  {
    slug: "meta",
    rootKey: "meta",
    label: "Meta soubory",
    description: "data/meta/ — JSON konfigurace (editor) a vodoznak.",
    writable: false,
  },
] as const;

export function getScope(slug: string): ScopeDef | undefined {
  return SCOPES.find((s) => s.slug === slug);
}

export interface ScopeEntry {
  name: string;
  size: number;
  /** `mtime.toISOString()` — kept as ISO string so it serialises
   *  cleanly for client components without a Date conversion dance. */
  mtime: string;
  isDirectory: boolean;
}

/** Lists files in a scope. Returns at most `limit` entries with
 *  filename matching `query` (case-insensitive substring). Sorts by
 *  filename ascending — predictable order beats mtime here because
 *  the user is usually looking for a specific find ID.
 *
 *  Hidden files (anything starting with `.`) are stripped before any
 *  other filter — that covers OS metadata noise (.DS_Store, ._*
 *  resource forks) and in-flight atomic-write temp files
 *  (.foo.<pid>.<rand>.tmp). The admin layer should never surface
 *  these to the user.
 *
 *  When `duplicatesOnly` is set, only entries that share their
 *  NFC-normalised name with at least one sibling on disk are kept.
 *  Useful for the "find Unicode duplicates" cleanup workflow. */
export async function listScope(
  scope: ScopeDef,
  opts: {
    query?: string;
    offset?: number;
    limit?: number;
    duplicatesOnly?: boolean;
    /** When supplied, entries whose NFC-normalised name is in this
     *  set are dropped before pagination. */
    excludeNamesNFC?: Set<string>;
    /** When supplied, entries whose leading numeric segment (find ID)
     *  is in this set are dropped before pagination. Used for the
     *  finds ↔ crops coverage filter — the two scopes share the
     *  find ID but the rest of the filename can drift (state token,
     *  note flag, location code edits over time), so name-based
     *  matching gives false negatives. ID-based matching is correct. */
    excludeFindIds?: Set<number>;
    /** When supplied, only entries whose NFC-normalised name passes
     *  this predicate are kept. Lets the caller layer arbitrary
     *  per-scope filters (e.g. maps anon/nonexistent toggles)
     *  without baking them into the generic listing helper. */
    keepName?: (nameNFC: string) => boolean;
  } = {},
): Promise<{ total: number; entries: ScopeEntry[] }> {
  const root = ADMIN_ROOTS[scope.rootKey];
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { total: 0, entries: [] };
    }
    throw err;
  }
  names = names.filter((n) => !n.startsWith("."));

  if (opts.duplicatesOnly) {
    const counts = new Map<string, number>();
    for (const n of names) {
      const key = n.normalize("NFC");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    names = names.filter((n) => (counts.get(n.normalize("NFC")) ?? 0) > 1);
  }

  if (opts.excludeNamesNFC) {
    const exclude = opts.excludeNamesNFC;
    names = names.filter((n) => !exclude.has(n.normalize("NFC")));
  }

  if (opts.excludeFindIds) {
    const exclude = opts.excludeFindIds;
    names = names.filter((n) => {
      const id = extractFindId(n);
      // Names without a leading digit run (maps, weird outliers)
      // pass through — the filter is meaningful only for finds/crops.
      if (id === null) return true;
      return !exclude.has(id);
    });
  }

  if (opts.keepName) {
    const keep = opts.keepName;
    names = names.filter((n) => keep(n.normalize("NFC")));
  }

  const q = opts.query?.trim().toLowerCase();
  const filtered = q
    ? names.filter((n) => n.toLowerCase().includes(q))
    : names;
  // `numeric: true` triggers natural sort: leading-number runs are
  // compared as numbers, so `1+…` < `2+…` < `10+…` < `100+…` instead
  // of the lexicographic `1+ … 10+ … 100+ … 2+` ordering you'd get
  // without it.
  filtered.sort((a, b) =>
    a.localeCompare(b, "cs", { numeric: true, sensitivity: "base" }),
  );
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 100;
  const slice = filtered.slice(offset, offset + limit);

  const entries = await Promise.all(
    slice.map(async (name) => {
      const stat = await fs.stat(path.join(root, name));
      return {
        name,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        isDirectory: stat.isDirectory(),
      } satisfies ScopeEntry;
    }),
  );
  return { total: filtered.length, entries };
}

/** Total bytes used by the files directly inside a scope's directory
 *  (sum of file sizes; dotfiles and subdirectories excluded). One
 *  fs.stat per entry, run in parallel — fine for the admin file pages,
 *  which call this once per render alongside the listing. Returns 0 when
 *  the directory doesn't exist yet. Missing/raced entries count as 0. */
export async function getScopeDiskBytes(scope: ScopeDef): Promise<number> {
  const root = ADMIN_ROOTS[scope.rootKey];
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
  names = names.filter((n) => !n.startsWith("."));
  const sizes = await Promise.all(
    names.map((name) =>
      fs
        .stat(path.join(root, name))
        .then((s) => (s.isFile() ? s.size : 0))
        .catch(() => 0),
    ),
  );
  return sizes.reduce((sum, n) => sum + n, 0);
}

/** Free disk space (bytes available to unprivileged users) on the
 *  filesystem that holds this scope's directory — shown next to the
 *  scope's own usage on the admin file pages. Falls back to the parent
 *  directory when the scope dir doesn't exist yet, and returns null when
 *  statfs is unavailable / fails so the UI can omit it gracefully. */
export async function getScopeDiskFreeBytes(
  scope: ScopeDef,
): Promise<number | null> {
  const root = ADMIN_ROOTS[scope.rootKey];
  for (const target of [root, path.dirname(root)]) {
    try {
      const s = await fs.statfs(target);
      // bavail = blocks available to unprivileged users; bsize = block
      // size. (bfree would include root-reserved space.)
      return s.bavail * s.bsize;
    } catch {
      /* try the parent dir next, then give up */
    }
  }
  return null;
}

export interface DiskUsage {
  /** Total filesystem size in bytes. */
  totalBytes: number;
  /** Bytes available to unprivileged users (what's actually usable). */
  freeBytes: number;
  /** totalBytes − freeBytes (so used + free === total exactly). */
  usedBytes: number;
  /** usedBytes / totalBytes, 0..1. Drives the dashboard's graduated
   *  storage warning. */
  usedFraction: number;
}

/** Overall disk usage for the filesystem that holds the given root
 *  (defaults to the collection data dir). Powers the admin dashboard
 *  storage tile. Falls back to the parent dir and returns null when
 *  statfs is unavailable / fails. */
export async function getDiskUsage(
  rootKey: AdminRootKey = "findOriginals",
): Promise<DiskUsage | null> {
  const root = ADMIN_ROOTS[rootKey];
  for (const target of [root, path.dirname(root)]) {
    try {
      const s = await fs.statfs(target);
      const totalBytes = s.blocks * s.bsize;
      const freeBytes = s.bavail * s.bsize;
      const usedBytes = Math.max(0, totalBytes - freeBytes);
      return {
        totalBytes,
        freeBytes,
        usedBytes,
        usedFraction: totalBytes > 0 ? usedBytes / totalBytes : 0,
      };
    } catch {
      /* try the parent dir next, then give up */
    }
  }
  return null;
}

/** Lightweight helper that returns the NFC-normalised name set of
 *  every entry in a scope (dotfiles excluded, no fs.stat per entry).
 *  Cheap enough to call on every page render. */
export async function listScopeNamesNFC(
  scope: ScopeDef,
): Promise<Set<string>> {
  const root = ADMIN_ROOTS[scope.rootKey];
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw err;
  }
  return new Set(
    names.filter((n) => !n.startsWith(".")).map((n) => n.normalize("NFC")),
  );
}

/** Returns the set of find IDs present in a scope — the leading
 *  numeric run of each filename. Used for finds ↔ crops coverage.
 *  Originals must have the full 6-segment convention, but crops are
 *  allowed to be just `<id>.jpg`, so the extractor only requires
 *  leading digits, not a trailing `+`. Files without a leading
 *  digit run (location maps, the rare malformed entry) are skipped. */
export async function listScopeFindIds(
  scope: ScopeDef,
): Promise<Set<number>> {
  const root = ADMIN_ROOTS[scope.rootKey];
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw err;
  }
  const ids = new Set<number>();
  for (const n of names) {
    if (n.startsWith(".")) continue;
    const id = extractFindId(n);
    if (id !== null) ids.add(id);
  }
  return ids;
}

/** Extracts the find ID from a filename — leading digit run.
 *  Matches both the full convention (`123+map+loc+state+anon+note.jpg`)
 *  and the short crop form (`123.jpg`). Returns null when the name
 *  doesn't start with digits at all (e.g. location map filenames). */
export function extractFindId(filename: string): number | null {
  const m = /^(\d+)/.exec(filename);
  return m ? Number(m[1]) : null;
}

/** Returns the prev/next siblings of a file inside its scope's
 *  default sorted listing — same `cs` localeCompare + `numeric: true`
 *  order the file list shows. NFC-aware: the lookup matches both
 *  NFC-normalised names (rsync from macOS sometimes drops NFD), so
 *  a detail page can land on a URL that came in either form and
 *  still find its neighbours.
 *
 *  Used by the detail page's prev/next buttons. The whole directory
 *  is read on every call — fine for admin's traffic level (single
 *  operator, low concurrency) and avoids any stale-cache divergence
 *  with the actual listing. */
export async function getScopeNeighbors(
  scope: ScopeDef,
  currentName: string,
): Promise<{ prev: string | null; next: string | null; index: number; total: number }> {
  const root = ADMIN_ROOTS[scope.rootKey];
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { prev: null, next: null, index: -1, total: 0 };
    }
    throw err;
  }
  const filtered = names.filter((n) => !n.startsWith("."));
  filtered.sort((a, b) =>
    a.localeCompare(b, "cs", { numeric: true, sensitivity: "base" }),
  );
  const currentNFC = currentName.normalize("NFC");
  const idx = filtered.findIndex((n) => n.normalize("NFC") === currentNFC);
  if (idx === -1) {
    return { prev: null, next: null, index: -1, total: filtered.length };
  }
  return {
    prev: idx > 0 ? filtered[idx - 1]! : null,
    next: idx < filtered.length - 1 ? filtered[idx + 1]! : null,
    index: idx,
    total: filtered.length,
  };
}

/** Scans `data/finds/` for the original photo of a given find ID and
 *  returns its on-disk filename. The match is anchored: the filename's
 *  leading digit run must equal `findId` exactly (so #18 doesn't pick
 *  up #182). Returns null when no match exists (find without an
 *  original on disk yet, or wrong ID). Used by photo detail pages to
 *  deep-link "back to the find original" without the user having to
 *  search.
 *
 *  Cheap enough to call per render — single readdir on a directory
 *  we already scan elsewhere, and the OS keeps it warm. */
export async function findOriginalFilenameById(
  findId: number,
): Promise<string | null> {
  if (!Number.isInteger(findId) || findId <= 0) return null;
  const root = ADMIN_ROOTS.findOriginals;
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  for (const name of names) {
    if (name.startsWith(".")) continue;
    if (extractFindId(name) === findId) return name;
  }
  return null;
}

/** Extracts the map ID from a location-map filename — the trailing
 *  5-digit run before the extension (per `parseMapFilename`'s regex).
 *  Returns null when the name doesn't conform. */
export function extractMapId(filename: string): number | null {
  const dot = filename.lastIndexOf(".");
  const stem = dot === -1 ? filename : filename.slice(0, dot);
  const m = /(?:^|[^0-9])(\d{5})$/.exec(stem);
  return m ? Number(m[1]) : null;
}

/** A contiguous run of missing IDs in `[min, max]`. `start` and `end`
 *  are inclusive; a singleton gap has `start === end`. */
export interface MissingRange {
  start: number;
  end: number;
}

export interface RangeAnalysis {
  /** Lowest extractable ID seen in the scope. */
  min: number;
  /** Highest extractable ID seen in the scope. */
  max: number;
  /** Distinct IDs present in the scope (each ID counted once). */
  uniqueIds: number;
  /** Sum of file occurrences across IDs — i.e. total visible files
   *  that yielded a parseable ID. Differs from `uniqueIds` when an
   *  ID shows up in multiple filenames (e.g. crops accept both
   *  `<id>+<segments>.jpg` and the short `<id>.jpg` form, so an ID
   *  can have two siblings). */
  filesWithId: number;
  /** Visible files (dotfiles excluded) where the extractor returned
   *  null — typically a stray README, JSON, or a malformed filename
   *  that doesn't start with the expected digit run. Helps the
   *  operator account for the gap between this scope's "X položek"
   *  count and uniqueIds without hunting manually. */
  filesWithoutId: number;
  /** Total IDs in [min, max] that don't have a corresponding file. */
  missingCount: number;
  /** Every gap in [min, max], compressed into contiguous ranges.
   *  Sorted ascending by `start`. The whole list is returned (no
   *  truncation). */
  missingRanges: MissingRange[];
  /** IDs that appear in more than one filename, sorted ascending.
   *  Drives the duplicate-ID highlight + filter on the listing page. */
  duplicateIds: number[];
}

/** Analyses ID coverage in a scope's directory. Returns null when
 *  the scope is empty or has no parseable IDs. The extractor decides
 *  what counts as an ID (find ID for finds/crops, map ID for maps). */
export async function analyzeIdRange(
  scope: ScopeDef,
  extractId: (filename: string) => number | null,
): Promise<RangeAnalysis | null> {
  const root = ADMIN_ROOTS[scope.rootKey];
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const occurrences = new Map<number, number>();
  let filesWithoutId = 0;
  for (const n of names) {
    if (n.startsWith(".")) continue;
    const id = extractId(n);
    if (id === null) {
      filesWithoutId += 1;
      continue;
    }
    occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
  }
  if (occurrences.size === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let filesWithId = 0;
  const duplicateIds: number[] = [];
  for (const [id, occurrenceCount] of occurrences) {
    if (id < min) min = id;
    if (id > max) max = id;
    filesWithId += occurrenceCount;
    if (occurrenceCount > 1) duplicateIds.push(id);
  }
  duplicateIds.sort((a, b) => a - b);

  const missingRanges: MissingRange[] = [];
  let missingCount = 0;
  let runStart: number | null = null;
  for (let i = min; i <= max; i += 1) {
    if (!occurrences.has(i)) {
      missingCount += 1;
      runStart ??= i;
    } else if (runStart !== null) {
      missingRanges.push({ start: runStart, end: i - 1 });
      runStart = null;
    }
  }
  if (runStart !== null) {
    missingRanges.push({ start: runStart, end: max });
  }
  return {
    min,
    max,
    uniqueIds: occurrences.size,
    filesWithId,
    filesWithoutId,
    missingCount,
    missingRanges,
    duplicateIds,
  };
}

export interface FileInfo {
  scope: ScopeSlug;
  name: string;
  absolutePath: string;
  size: number;
  mtime: string;
  contentType: string;
}

const EXT_TO_MIME: Record<string, string> = {
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".json": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
};

/** Resolves a scope+filename to an absolute path + stat metadata.
 *  Returns null when the file doesn't exist (caller renders 404).
 *  Throws on path traversal so the API endpoint can surface a 400.
 *
 *  Unicode-tolerant: rsync from macOS delivers NFD-encoded filenames
 *  to the Linux box, but Safari (and sometimes Chrome) normalize URL
 *  characters to NFC when fetching subresources via `<img src>` or
 *  `<a download>`. Top-level page navigation tends to preserve the
 *  original bytes, so the listing → detail page round-trip works
 *  byte-for-byte while the same filename in a subresource URL
 *  arrives at the server in a different normalization form. We try
 *  the byte-exact path first (cheap, hits in nearly every case
 *  where the URL came from a hand-typed path or the listing link
 *  for an ASCII filename), then fall back to a directory scan that
 *  compares NFC forms — guaranteed to find any name regardless of
 *  which side normalized. */
export async function statScopeFile(
  scope: ScopeDef,
  filename: string,
): Promise<FileInfo | null> {
  let resolved = await resolveDiskPath(scope.rootKey, filename);
  // v2 maps live nested under `Nosné mapy/…` — the flat resolveDiskPath
  // (which only scans data/maps/ directly) misses them. Fall back to the
  // manifest, matching the Nosná basename, so detail pages + the file
  // endpoint can serve v2 map images.
  if (!resolved && scope.slug === "maps") {
    resolved = await resolveV2MapFileByName(filename);
  }
  if (!resolved) return null;
  let stat;
  try {
    stat = await fs.stat(resolved.absolutePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  if (!stat.isFile()) return null;
  const ext = path.extname(resolved.name).toLowerCase();
  return {
    scope: scope.slug,
    // Return the on-disk form so callers building URLs back to this
    // file (e.g. <img src>) round-trip through whatever normalization
    // the browser applies and still resolve correctly here.
    name: resolved.name,
    absolutePath: resolved.absolutePath,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    contentType: EXT_TO_MIME[ext] ?? "application/octet-stream",
  };
}
