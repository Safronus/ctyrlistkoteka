import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicWrite, ensureDir } from "@/lib/admin/atomic";
import { ADMIN_ROOTS } from "@/lib/admin/paths";

/**
 * Admin-managed, web-display-only note overrides for finds. A "middle
 * layer" between the raw filename / LSP-JSON note and what the site shows
 * in the banner under the find photo — so a note can carry characters the
 * filename can't (colons, dots, …) and gain an optional English variant.
 * The filename + LSP JSON are left untouched.
 *
 * Stored in `data/.admin/` (like check-acks / sync-status): admin runtime
 * state that survives both the Mac→VPS rsync and a full DB re-sync, and is
 * read directly by the web (never imported into the DB by sync).
 *
 * File shape — keyed by find id:
 *   { "23059": { "cs": "Poznámka…", "en": "Note…" } }
 * `en` is optional; when it's absent the EN site shows the CS text plus a
 * "Czech only" flag (same fallback as an untranslated LSP note).
 */

export interface FindNoteOverride {
  cs?: string;
  en?: string;
}

const ADMIN_DIR = path.join(ADMIN_ROOTS.meta, "..", ".admin");
const FILE = path.join(ADMIN_DIR, "find-note-overrides.json");

function clean(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Full store as a Map<findId, override>. Empty on a missing/corrupt file. */
export async function readFindNoteOverrides(): Promise<
  Map<number, FindNoteOverride>
> {
  let raw: string;
  try {
    raw = await fs.readFile(FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw err;
  }
  const out = new Map<number, FindNoteOverride>();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return out;
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const id = Number(k);
      if (!Number.isInteger(id) || !v || typeof v !== "object") continue;
      const cs = clean((v as Record<string, unknown>).cs);
      const en = clean((v as Record<string, unknown>).en);
      if (cs || en) {
        out.set(id, { ...(cs ? { cs } : {}), ...(en ? { en } : {}) });
      }
    }
  } catch {
    return new Map();
  }
  return out;
}

/** A single find's override, or null. Used by the web note banner. */
export async function getFindNoteOverride(
  id: number,
): Promise<FindNoteOverride | null> {
  return (await readFindNoteOverrides()).get(id) ?? null;
}

/** Upsert a find's override (or delete it when both variants are blank).
 *  Admin / server-action only — the web just reads. */
export async function writeFindNoteOverride(
  id: number,
  override: FindNoteOverride,
): Promise<void> {
  const all = await readFindNoteOverrides();
  const cs = clean(override.cs);
  const en = clean(override.en);
  if (!cs && !en) all.delete(id);
  else all.set(id, { ...(cs ? { cs } : {}), ...(en ? { en } : {}) });

  // Serialise sorted by id for stable, reviewable diffs.
  const obj: Record<string, FindNoteOverride> = {};
  for (const key of [...all.keys()].sort((a, b) => a - b)) {
    obj[String(key)] = all.get(key)!;
  }
  await ensureDir(ADMIN_DIR);
  await atomicWrite(FILE, `${JSON.stringify(obj, null, 2)}\n`);
}
