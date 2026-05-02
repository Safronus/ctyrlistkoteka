import { promises as fs } from "node:fs";
import path from "node:path";
import { ADMIN_ROOTS, type AdminRootKey, safeJoin } from "./paths";

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
    description: "data/finds/ — celé fotky čtyřlístků (HEIC).",
    writable: false,
  },
  {
    slug: "crops",
    rootKey: "findCrops",
    label: "Výřezy nálezů",
    description: "data/crops/ — vyřezané čtyřlístky (HEIC).",
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
 *  the user is usually looking for a specific find ID. */
export async function listScope(
  scope: ScopeDef,
  opts: { query?: string; offset?: number; limit?: number } = {},
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
  const q = opts.query?.trim().toLowerCase();
  const filtered = q
    ? names.filter((n) => n.toLowerCase().includes(q))
    : names;
  filtered.sort((a, b) => a.localeCompare(b, "cs"));
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
 *  Throws on path traversal so the API endpoint can surface a 400. */
export async function statScopeFile(
  scope: ScopeDef,
  filename: string,
): Promise<FileInfo | null> {
  const abs = safeJoin(scope.rootKey, filename);
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  if (!stat.isFile()) return null;
  const ext = path.extname(filename).toLowerCase();
  return {
    scope: scope.slug,
    name: path.basename(filename),
    absolutePath: abs,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    contentType: EXT_TO_MIME[ext] ?? "application/octet-stream",
  };
}
