import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Captions for the real photos of a location ("pohled od cesty").
 *
 * They live in `data/` rather than next to the images in `generated/`
 * because they are not derived from anything: the image can be rebuilt by
 * re-importing the package, a caption typed on the desktop cannot. Keyed
 * by the five-digit location number and the photo's order — the same pair
 * the filename carries — so a re-import of the same photo replaces its
 * caption instead of adding a second one.
 *
 * Read on public pages, written only by the admin importer.
 */

export interface CaptionStore {
  /** "00126" → { "1": "pohled od cesty" } */
  [locationNumber: string]: Record<string, string>;
}

const FILE_NAME = "location-photos.json";
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { data: CaptionStore; loadedAt: number } | null = null;

export function captionsFilePath(): string {
  const dataDir = process.env.DATA_DIR ?? "./data";
  return path.join(dataDir, ".admin", FILE_NAME);
}

/** Drops the in-memory copy so an import shows up on the next render. */
export function invalidateCaptionsCache(): void {
  cache = null;
}

export async function readCaptions(): Promise<CaptionStore> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.data;
  let data: CaptionStore = {};
  try {
    const raw = await fs.readFile(captionsFilePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    // Shape-checked rather than trusted: this file is hand-editable, and a
    // caption is decoration — a malformed one must not take a page down.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = {};
      for (const [num, entry] of Object.entries(parsed as CaptionStore)) {
        if (!/^\d{5}$/.test(num) || typeof entry !== "object" || !entry) continue;
        const out: Record<string, string> = {};
        for (const [order, text] of Object.entries(entry)) {
          if (/^\d+$/.test(order) && typeof text === "string" && text.trim()) {
            out[order] = text.normalize("NFC").trim();
          }
        }
        if (Object.keys(out).length > 0) data[num] = out;
      }
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[locationPhotos] captions unreadable", e);
    }
  }
  cache = { data, loadedAt: now };
  return data;
}

/** One caption, or null. Order is the photo's `poradi`. */
export async function readCaption(
  locationNumber: string,
  order: number,
): Promise<string | null> {
  const all = await readCaptions();
  return all[locationNumber]?.[String(order)] ?? null;
}
