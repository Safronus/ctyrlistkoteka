import path from "node:path";

/** Roots the admin layer is allowed to read/write. Anything outside
 *  these is rejected by `safeJoin` even if asked. Mirrors the rule in
 *  CLAUDE.md §9 — keep this list in sync with the prose there. */
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), "data");
const GENERATED_DIR = process.env.GENERATED_DIR
  ? path.resolve(process.env.GENERATED_DIR)
  : path.resolve(process.cwd(), "public", "generated");
const SECURE_DIR = process.env.ADMIN_SECURE_DIR
  ? path.resolve(process.env.ADMIN_SECURE_DIR)
  : path.resolve(DATA_DIR, "..", "secure");

/** Whitelist of subroots admin operations may touch. Listed by purpose
 *  so the call sites read clearly — `findOriginals` rather than a raw
 *  string concatenation. */
export const ADMIN_ROOTS = {
  findOriginals: path.join(DATA_DIR, "finds", "originals"),
  findCrops: path.join(DATA_DIR, "finds", "crops"),
  findRaws: path.join(DATA_DIR, "finds", "raws"),
  locationMaps: path.join(DATA_DIR, "maps"),
  jsonRoot: DATA_DIR,
  trash: path.join(DATA_DIR, ".trash"),
  donationPhotos: path.join(GENERATED_DIR, "find-photos"),
  locationPhotos: path.join(GENERATED_DIR, "location-photos"),
  secure: SECURE_DIR,
} as const;

export type AdminRootKey = keyof typeof ADMIN_ROOTS;

/** Resolves `relative` against the named root and guarantees the result
 *  stays inside that root. Throws on path traversal, absolute paths,
 *  or anything containing a NUL byte. Returns the absolute path. */
export function safeJoin(rootKey: AdminRootKey, relative: string): string {
  if (typeof relative !== "string") {
    throw new Error("safeJoin: relative path must be a string");
  }
  if (relative.includes("\0")) {
    throw new Error("safeJoin: NUL byte in path");
  }
  if (path.isAbsolute(relative)) {
    throw new Error("safeJoin: absolute paths are not allowed");
  }
  const root = ADMIN_ROOTS[rootKey];
  const resolved = path.resolve(root, relative);
  // `relative()` returns ".." prefix when `resolved` escapes `root`,
  // which is the canonical way to detect traversal post-normalisation.
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `safeJoin: path '${relative}' escapes root '${rootKey}'`,
    );
  }
  return resolved;
}

/** Sanitises a user-provided basename. Strips any path separator and
 *  rejects empty / dot-only / hidden-file names. Returns the safe name
 *  or throws. Use this on any filename coming from the client (form
 *  fields, FormData entries) before passing to safeJoin. */
export function safeBaseName(name: string): string {
  const base = path.basename(name).normalize("NFC");
  if (!base || base === "." || base === ".." || base.startsWith(".")) {
    throw new Error(`safeBaseName: rejected name '${name}'`);
  }
  if (base.includes("/") || base.includes("\\") || base.includes("\0")) {
    throw new Error(`safeBaseName: invalid characters in '${name}'`);
  }
  return base;
}
