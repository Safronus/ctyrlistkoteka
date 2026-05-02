import { promises as fs } from "node:fs";
import path from "node:path";
import { ADMIN_ROOTS } from "./paths";
import { parsePngTextChunks, readAnonymizedFlag } from "@/lib/images";

/** Reads PNG/JPEG tEXt chunks for every map in `data/maps/` and
 *  returns the names whose `Anonymizovaná lokace` flag is set. The
 *  result is a Set of NFC-normalised names so callers can match
 *  regardless of macOS-rsync NFD drift.
 *
 *  Caching: keyed by name+mtime, in-memory across requests. The
 *  admin listing is the only consumer; cache size is bounded by the
 *  map directory (~130 entries today, growing slowly). LRU isn't
 *  needed at this scale — old entries naturally fall out when the
 *  file list shrinks. */
interface CacheEntry {
  mtimeMs: number;
  isAnonymized: boolean;
}
const cache = new Map<string, CacheEntry>();

export async function readMapAnonFlags(): Promise<Set<string>> {
  const root = ADMIN_ROOTS.locationMaps;
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw err;
  }
  // Skip dotfiles + drop the NEEXISTUJE- prefix from the name when
  // scanning bytes (the file content doesn't change after renaming).
  // We still cache under the on-disk name so the next call hits.
  const candidates = names.filter((n) => !n.startsWith("."));

  // Run reads concurrently — each is a single fs.stat + (cache miss
  // path) up to 64 KB read. Node's default fs concurrency is enough
  // headroom for ~150 entries.
  const results = await Promise.all(
    candidates.map(async (name) => {
      const abs = path.join(root, name);
      try {
        const stat = await fs.stat(abs);
        const cached = cache.get(name);
        if (cached && cached.mtimeMs === stat.mtimeMs) {
          return cached.isAnonymized
            ? name.normalize("NFC")
            : null;
        }
        // Read just the first 64 KB — PNG tEXt chunks live near the
        // start (after IHDR), and JPEG comments / EXIF are also at
        // the head. A full-file read would balloon to MBs per scan.
        const fh = await fs.open(abs, "r");
        try {
          const buf = Buffer.alloc(64 * 1024);
          const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
          const slice = buf.subarray(0, bytesRead);
          const tags = parsePngTextChunks(slice);
          const isAnonymized = readAnonymizedFlag(tags);
          cache.set(name, { mtimeMs: stat.mtimeMs, isAnonymized });
          return isAnonymized ? name.normalize("NFC") : null;
        } finally {
          await fh.close();
        }
      } catch {
        return null;
      }
    }),
  );
  const out = new Set<string>();
  for (const r of results) {
    if (r !== null) out.add(r);
  }
  return out;
}
