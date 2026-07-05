import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicWrite, ensureDir } from "@/lib/admin/atomic";
import { ADMIN_ROOTS } from "@/lib/admin/paths";

/**
 * Admin-managed, web-display-only note overrides for location maps — the
 * exact analogue of {@link file://./findNoteOverrides.ts} but keyed by
 * MAP_ID. A "middle layer" between the raw map filename description
 * (`location_maps.description`) and the caption the site shows under the
 * location map, so a caption can carry characters the filename can't
 * (colons, dots, …) and gain an optional English variant. The filename +
 * DB row are left untouched.
 *
 * Stored in `data/.admin/` (like find-note-overrides / check-acks): admin
 * runtime state that survives both the Mac→VPS rsync and a full DB re-sync,
 * and is read directly by the web (never imported into the DB by sync).
 *
 * File shape — keyed by MAP_ID:
 *   { "55": { "cs": "Popisek…", "en": "Caption…" } }
 * `en` is optional; when it's absent the EN site shows the CS text plus a
 * "Czech only" flag (same fallback as an untranslated find note).
 */

export interface MapNoteOverride {
  cs?: string;
  en?: string;
}

const ADMIN_DIR = path.join(ADMIN_ROOTS.meta, "..", ".admin");
const FILE = path.join(ADMIN_DIR, "map-note-overrides.json");

function clean(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Full store as a Map<mapId, override>. Empty on a missing/corrupt file. */
export async function readMapNoteOverrides(): Promise<
  Map<number, MapNoteOverride>
> {
  let raw: string;
  try {
    raw = await fs.readFile(FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw err;
  }
  const out = new Map<number, MapNoteOverride>();
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

/** A single map's override, or null. Used by the web map caption. */
export async function getMapNoteOverride(
  id: number,
): Promise<MapNoteOverride | null> {
  return (await readMapNoteOverrides()).get(id) ?? null;
}

/** Upsert a map's override (or delete it when both variants are blank).
 *  Admin / server-action only — the web just reads. */
export async function writeMapNoteOverride(
  id: number,
  override: MapNoteOverride,
): Promise<void> {
  const all = await readMapNoteOverrides();
  const cs = clean(override.cs);
  const en = clean(override.en);
  if (!cs && !en) all.delete(id);
  else all.set(id, { ...(cs ? { cs } : {}), ...(en ? { en } : {}) });

  // Serialise sorted by id for stable, reviewable diffs.
  const obj: Record<string, MapNoteOverride> = {};
  for (const key of [...all.keys()].sort((a, b) => a - b)) {
    obj[String(key)] = all.get(key)!;
  }
  await ensureDir(ADMIN_DIR);
  await atomicWrite(FILE, `${JSON.stringify(obj, null, 2)}\n`);
}
