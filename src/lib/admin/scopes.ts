import { promises as fs } from "node:fs";
import path from "node:path";
import { ADMIN_ROOTS, type AdminRootKey, safeJoin } from "./paths";

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

  try {
    await fs.access(direct);
    return { name: baseName, absolutePath: direct };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
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
  return match ? { name: match, absolutePath: path.join(root, match) } : null;
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
    writable: false,
  },
  {
    slug: "crops",
    rootKey: "findCrops",
    label: "Výřezy nálezů",
    description: "data/crops/ — vyřezané čtyřlístky (JPEG).",
    writable: false,
  },
  {
    slug: "maps",
    rootKey: "locationMaps",
    label: "Lokační mapy",
    description: "data/maps/ — PNG mapy lokalit (z Map Marker apod.).",
    writable: false,
  },
  {
    slug: "meta",
    rootKey: "meta",
    label: "Meta soubory",
    description: "data/meta/ — JSONy a vodoznak.",
    writable: false,
  },
  {
    slug: "donation-photos",
    rootKey: "donationPhotos",
    label: "Reálné fotky darů",
    description: "generated/find-photos/ — fotky darovaných čtyřlístků.",
    writable: false,
  },
  {
    slug: "location-photos",
    rootKey: "locationPhotos",
    label: "Reálné fotky lokalit",
    description: "generated/location-photos/ — placeholder pro budoucí použití.",
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
  const resolved = await resolveDiskPath(scope.rootKey, filename);
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
