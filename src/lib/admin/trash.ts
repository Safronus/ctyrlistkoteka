import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, trashTimestamp } from "./atomic";
import { ADMIN_ROOTS } from "./paths";

/**
 * The recycle bin under `data/.trash/<timestamp>/<scope>/`, and the
 * retention CLAUDE.md §9 has always promised.
 *
 * Destructive admin operations copy their target here before touching
 * it, which is what makes them undoable. Nothing ever emptied it,
 * though — the "auto-prune po 30 dnech" in §9 described an intention,
 * not code, and by 2026-08-10 the bin held 197 MB on the VPS. This
 * module is that missing half.
 *
 * Pruning runs off the back of a write rather than from a timer: the
 * bin only grows when something is written to it, so that is exactly
 * when it is worth looking, and it adds nothing to the server that
 * could quietly stop running.
 */

/** How long a deleted file stays recoverable. CLAUDE.md §9 says 30 days;
 *  changing it here means changing it there too. */
export const TRASH_RETENTION_DAYS = 30;

/** Don't rescan the whole bin on every file of a 500-file batch — once
 *  per this window per process is plenty for a bin that only grows when
 *  someone deletes something. */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** Bucket directories are named by `trashTimestamp()`: `YYYYMMDDTHHmmss`.
 *  Anything that does not match is left alone — a directory we cannot
 *  date is a directory we have no business deleting. */
const BUCKET_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/;

let lastPruneAt = 0;

/** Parses a bucket name into its UTC creation time, or null if the name
 *  isn't one of ours. */
export function parseBucketTime(name: string): Date | null {
  const m = BUCKET_RE.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (Number.isNaN(date.getTime())) return null;
  // Round-trip guard: rejects "20260231T000000", which Date.UTC would
  // happily roll over into March rather than refusing.
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

/** Names of the buckets that are older than the retention window.
 *  Pure — takes the listing and the clock, so the decision is testable
 *  without a filesystem. */
export function expiredBuckets(
  names: string[],
  now: Date,
  retentionDays = TRASH_RETENTION_DAYS,
): string[] {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return names.filter((name) => {
    const created = parseBucketTime(name);
    return created !== null && created.getTime() < cutoff;
  });
}

/**
 * Removes expired buckets. Only ever touches direct children of
 * `.trash` whose names it can date — never recurses anywhere else, and
 * never deletes a directory it doesn't recognise.
 *
 * Returns what it removed, for the caller to log. Never throws: a bin
 * that can't be tidied must not take down the delete the user actually
 * asked for.
 */
export async function pruneTrash(
  now: Date = new Date(),
  retentionDays = TRASH_RETENTION_DAYS,
): Promise<string[]> {
  let entries: string[];
  try {
    const dirents = await fs.readdir(ADMIN_ROOTS.trash, {
      withFileTypes: true,
    });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return []; // bin not created yet — nothing to do
  }

  const removed: string[] = [];
  for (const name of expiredBuckets(entries, now, retentionDays)) {
    try {
      // `force` because two PM2 workers can reach the same bucket at
      // once and the loser must not throw on an already-gone directory.
      await fs.rm(path.join(ADMIN_ROOTS.trash, name), {
        recursive: true,
        force: true,
      });
      removed.push(name);
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "trash_prune_failed",
          bucket: name,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  if (removed.length > 0) {
    console.info(
      JSON.stringify({
        level: "info",
        event: "trash_pruned",
        buckets: removed.length,
        retentionDays,
      }),
    );
  }
  return removed;
}

/**
 * The one way to open a trash bucket: builds
 * `.trash/<timestamp>/<scope>/`, creates it, and takes the opportunity
 * to drop whatever has aged out.
 *
 * Call sites used to repeat `path.join(ADMIN_ROOTS.trash,
 * trashTimestamp(), scope)` + `ensureDir` in twenty-one places, which is
 * also why there was nowhere sensible to hang the prune. Keep it that
 * way — a new trash write should go through here.
 */
export async function prepareTrashDir(
  scope: string,
  /** Pass your own when the batch id is also needed elsewhere (bulk
   *  actions record it in the audit log as `batch`), so the directory
   *  and the logged id can't disagree. */
  timestamp: string = trashTimestamp(),
): Promise<string> {
  const dir = path.join(ADMIN_ROOTS.trash, timestamp, scope);
  await ensureDir(dir);

  const now = Date.now();
  if (now - lastPruneAt >= PRUNE_INTERVAL_MS) {
    lastPruneAt = now;
    await pruneTrash();
  }
  return dir;
}
