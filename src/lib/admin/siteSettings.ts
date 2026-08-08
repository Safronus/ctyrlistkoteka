import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicWrite, ensureDir } from "@/lib/admin/atomic";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import { DISTANCE_ORIGIN_LOCATION_ID } from "@/lib/constants";

/**
 * The handful of site-wide knobs that belong to the owner, not to code.
 *
 * Lives in `data/.admin/site-settings.json` next to the other admin
 * configs. Deliberately tiny and additive: each field falls back to the
 * constant it replaces, so an absent (or corrupt) file behaves exactly
 * like the build did before this existed.
 */

const ADMIN_DIR = path.join(ADMIN_ROOTS.backups, "..");
const SETTINGS_FILE = path.join(ADMIN_DIR, "site-settings.json");

export interface SiteSettings {
  /**
   * Location whose centre every "how far is this find" distance is
   * measured from. Was a hard-coded constant; the collection's centre of
   * gravity moves, and repointing it should not need a deploy.
   */
  distanceOriginLocationId: number;
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  distanceOriginLocationId: DISTANCE_ORIGIN_LOCATION_ID,
};

/**
 * Reads the settings, falling back field by field.
 *
 * Never throws: this is on the path of every page that shows a distance,
 * and a malformed file must degrade to the defaults rather than take the
 * public site down.
 */
export async function readSiteSettings(): Promise<SiteSettings> {
  try {
    const raw = JSON.parse(await fs.readFile(SETTINGS_FILE, "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return DEFAULT_SITE_SETTINGS;
    const o = raw as Record<string, unknown>;
    const id = Number(o.distanceOriginLocationId);
    return {
      distanceOriginLocationId:
        Number.isInteger(id) && id > 0
          ? id
          : DEFAULT_SITE_SETTINGS.distanceOriginLocationId,
    };
  } catch {
    return DEFAULT_SITE_SETTINGS;
  }
}

export async function writeSiteSettings(next: SiteSettings): Promise<void> {
  await ensureDir(ADMIN_DIR);
  await atomicWrite(SETTINGS_FILE, Buffer.from(JSON.stringify(next, null, 2)));
}

/**
 * The distance origin, cached per file mtime.
 *
 * Called from the query layer on pages that show "how far from home", so
 * it must not turn into a file read per request — but it also must not go
 * stale after the owner changes it, and PM2 runs more than one worker, so
 * an in-process TTL would leave workers disagreeing. Watching the mtime
 * costs one `stat` and every worker notices the same instant.
 *
 * Same shape as the clover-texts loader; see cloverTextsServer.ts.
 */
let cached: { mtimeMs: number; id: number } | null = null;

export async function getDistanceOriginLocationId(): Promise<number> {
  try {
    const { mtimeMs } = await fs.stat(SETTINGS_FILE);
    if (cached && cached.mtimeMs === mtimeMs) return cached.id;
    const id = (await readSiteSettings()).distanceOriginLocationId;
    cached = { mtimeMs, id };
    return id;
  } catch {
    // No file yet — the constant IS the setting until somebody changes it.
    return DEFAULT_SITE_SETTINGS.distanceOriginLocationId;
  }
}
