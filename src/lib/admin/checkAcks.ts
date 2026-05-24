import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicWrite, ensureDir } from "./atomic";
import { ADMIN_ROOTS } from "./paths";

/**
 * Per-check acknowledgement store. The /admin/checks page exposes
 * an "OK, tohle je v pořádku" action on each offender row; the
 * acknowledgement persists across sync runs by writing the
 * offender's id (find id or map id, depending on the check) into
 * this JSON file. The check implementation then filters acked ids
 * out of its offender list before returning.
 *
 * Lives in `data/.admin/` next to sync-status.json — same logic as
 * syncRunner.ts: admin-side runtime state, doesn't travel via the
 * Mac→VPS rsync (which only touches `data/finds/`, `data/maps/`,
 * `data/meta/`). The directory is created on first write.
 *
 * File shape: a flat object keyed by check id, each value an array
 * of integer ids. Unknown check ids are ignored on read so an old
 * acks file from a renamed check doesn't crash startup.
 *
 *   { "map-center-outside-polygon": [128, 245],
 *     "originals-without-crop": [16234] }
 */

const ADMIN_DIR = path.join(ADMIN_ROOTS.meta, "..", ".admin");
const ACKS_FILE = path.join(ADMIN_DIR, "check-acks.json");

type CheckAcks = Record<string, number[]>;

export async function readCheckAcks(): Promise<CheckAcks> {
  let raw: string;
  try {
    raw = await fs.readFile(ACKS_FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: CheckAcks = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      const ids = v.filter(
        (x): x is number => typeof x === "number" && Number.isInteger(x),
      );
      if (ids.length > 0) out[k] = ids;
    }
    return out;
  } catch {
    // Corrupt file → return empty rather than fail-closed; the user
    // can still see ALL offenders, which is the safe default.
    return {};
  }
}

/** Returns the set of acknowledged ids for a single check. Caller
 *  uses `.has(id)` to filter the offender list before rendering. */
export async function readCheckAckSet(checkId: string): Promise<Set<number>> {
  const all = await readCheckAcks();
  return new Set(all[checkId] ?? []);
}

/** Adds an id to a check's ack list. Idempotent — adding the same
 *  id twice leaves the list unchanged. */
export async function addCheckAck(
  checkId: string,
  offenderId: number,
): Promise<void> {
  if (!Number.isInteger(offenderId)) {
    throw new Error("addCheckAck: offenderId must be an integer");
  }
  await ensureDir(ADMIN_DIR);
  const current = await readCheckAcks();
  const ids = current[checkId] ?? [];
  if (ids.includes(offenderId)) return;
  current[checkId] = [...ids, offenderId].sort((a, b) => a - b);
  await atomicWrite(ACKS_FILE, JSON.stringify(current, null, 2) + "\n");
}
