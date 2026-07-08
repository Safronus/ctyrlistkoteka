import { promises as fs } from "node:fs";
import path from "node:path";
import { ADMIN_ROOTS } from "./paths";
import { atomicWrite, ensureDir } from "./atomic";

/** "Has anything in the synced data dirs changed since the last
 *  successful `pnpm sync`?" — drives the orange "Změny od posledního
 *  syncu" banner on file listings + JSON náhled.
 *
 *  Strategy: compare the directory's mtime (Linux updates it on
 *  add/remove/rename, including atomic-write rename, including rsync
 *  with default tmp+rename behaviour) against `data/.admin/last-sync-
 *  success.json`. The marker is written by syncRunner only when a
 *  run exits with code 0; failures don't bump it.
 *
 *  We don't `fs.stat` every file in the dir — at 17k finds that'd be
 *  500 ms+ per page render. The dir-mtime heuristic misses pure
 *  in-place content edits (rare for image files; never happens via
 *  admin which uses atomic writes), but covers the actual workflows
 *  (rsync new files, admin upload/delete/rename). */

const LAST_SUCCESS_FILE = path.join(
  ADMIN_ROOTS.meta,
  "..",
  ".admin",
  "last-sync-success.json",
);

/** Sync scopes the runner accepts. `meta` covers the JSON file;
 *  `finds` covers both data/finds and data/crops (sync.ts treats
 *  them together via `--only=finds`); `maps` covers data/maps. */
export type SyncScope = "finds" | "maps" | "meta";

export interface LastSyncSuccess {
  /** ISO timestamp of when the run finished successfully. */
  endedAt: string;
  /** Argv copied from the matching SyncStatus.args. */
  args: string[];
  /** Run identifier (data/.admin/logs/sync-<runId>.log). */
  runId: string;
}

export async function readLastSyncSuccess(): Promise<LastSyncSuccess | null> {
  try {
    const raw = await fs.readFile(LAST_SUCCESS_FILE, "utf8");
    return JSON.parse(raw) as LastSyncSuccess;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

export async function writeLastSyncSuccess(
  entry: LastSyncSuccess,
): Promise<void> {
  // Atomic (tmp → fsync → rename) for consistency with every other admin
  // state write (CLAUDE.md §9a); a torn write here would only mis-drive the
  // "changes since last sync" banner, but uniform atomicity keeps the
  // invariant honest and cheap. atomicWrite requires the parent dir to
  // exist, so ensureDir first (mirrors the previous fs.mkdir).
  await ensureDir(path.dirname(LAST_SUCCESS_FILE));
  await atomicWrite(LAST_SUCCESS_FILE, JSON.stringify(entry, null, 2));
}

const DIR_KEYS_BY_SCOPE: Record<SyncScope, Array<keyof typeof ADMIN_ROOTS>> = {
  finds: ["findOriginals", "findCrops"],
  maps: ["locationMaps"],
  meta: ["meta"],
};

export interface SyncNeededResult {
  needed: boolean;
  /** ISO timestamp of last successful sync, or null when never run. */
  lastSuccessAt: string | null;
  /** List of dirs (absolute) whose mtime is newer than lastSuccess.
   *  Empty when no sync has ever succeeded. */
  dirty: string[];
}

async function maxMtime(absPaths: string[]): Promise<number> {
  let max = 0;
  for (const p of absPaths) {
    try {
      const stat = await fs.stat(p);
      if (stat.mtimeMs > max) max = stat.mtimeMs;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }
  return max;
}

/** Computes whether the given scopes need re-syncing. Pass a single
 *  scope or several; the result aggregates across all of them. */
export async function checkSyncNeeded(
  scopes: SyncScope[],
): Promise<SyncNeededResult> {
  const last = await readLastSyncSuccess();
  if (!last) {
    // Never synced — the data is "dirty" by definition. List the
    // requested dirs as candidates so the banner can name them.
    const dirs: string[] = [];
    for (const s of scopes) {
      for (const key of DIR_KEYS_BY_SCOPE[s]) {
        dirs.push(ADMIN_ROOTS[key]);
      }
    }
    return { needed: true, lastSuccessAt: null, dirty: dirs };
  }
  const lastMs = Date.parse(last.endedAt);
  const dirty: string[] = [];
  for (const s of scopes) {
    for (const key of DIR_KEYS_BY_SCOPE[s]) {
      const root = ADMIN_ROOTS[key];
      const m = await maxMtime([root]);
      if (m > lastMs) dirty.push(root);
    }
  }
  return {
    needed: dirty.length > 0,
    lastSuccessAt: last.endedAt,
    dirty,
  };
}
