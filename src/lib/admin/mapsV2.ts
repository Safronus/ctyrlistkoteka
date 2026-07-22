/**
 * Helpers for the location-map **v2 web package** as it sits on disk under
 * `data/maps/` (`manifest.json` + `Nosné mapy/` + `Rendered mapy/`).
 *
 * The v2 package is authoritative and managed as a whole through
 * `/admin/import` (the ZIP flow → `phaseMapsV2` in sync). The legacy
 * per-file admin actions (delete / rename / mark-nonexistent / replace /
 * anonymize) were written for the flat v1 filename convention and must never
 * touch the v2 artifacts — trashing `manifest.json` or renaming the
 * `Nosné mapy` tree silently breaks `pnpm sync`. This module is the single
 * guard that keeps those actions off the v2 package.
 *
 * It also reads the manifest for the admin listing (`readMapInventory`) and
 * resolves a nested Nosná PNG by basename (`resolveV2MapFileByName`), since a
 * flat readdir of data/maps/ can't see the nested v2 tree.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { ADMIN_ROOTS } from "./paths";
import {
  parseMapPackageManifest,
  entryNumber,
  displayNameFor,
} from "@/lib/mapPackage";

/** Names directly inside `data/maps/` that belong to the v2 package. Compared
 *  NFC + lowercased so an rsync-from-macOS NFD form or a case slip still
 *  matches. The two directory names are here for defence-in-depth — the
 *  per-file actions already reject non-files — plus a clear error message. */
const V2_RESERVED_NFC: ReadonlySet<string> = new Set([
  "manifest.json",
  "nosné mapy",
  "rendered mapy",
]);

/** True when `name` is a v2-package artifact that per-file map actions must
 *  refuse (manifest.json or the Nosné/Rendered mapy directories). */
export function isV2ReservedMapName(name: string): boolean {
  return V2_RESERVED_NFC.has(name.normalize("NFC").toLowerCase());
}

/** Throws when `name` is a v2-package artifact. Call at the top of every
 *  mutating maps action (right after `safeBaseName`) so a stray delete /
 *  rename / replace can't corrupt the v2 package. Managed via /admin/import. */
export function assertMutableMapFile(name: string): void {
  if (isV2ReservedMapName(name)) {
    throw new Error(
      `„${name}" patří k balíčku map verze 2 (manifest.json / Nosné mapy / Rendered mapy) — přes tuto akci ho nelze mazat ani měnit. Mapy verze 2 se spravují jako celek přes /admin/import.`,
    );
  }
}

// ---------------------------------------------------------------------------
// v2 inventory — the manifest is the authoritative list of maps. The admin
// maps listing reads THIS, not a flat readdir of data/maps/ (which only
// returns manifest.json + the Nosné/Rendered mapy dirs + stray v1 PNGs).
// ---------------------------------------------------------------------------

/** One map as the admin listing sees it, projected from a manifest entry
 *  plus the on-disk stat of its Nosná PNG. `nosnaName` (the basename) is the
 *  stable identity the admin URLs + per-row note editor key on — it ends in
 *  the 5-digit číslo (`…+00025.png`), so `extractMapId` still works. */
export interface MapInventoryEntry {
  /** 5-digit číslo as a number (the location/map PK). */
  cislo: number;
  /** id_lokace (location code) — public even for anon maps. */
  code: string;
  /** popis → geo_adresa → id_lokace fallback (never the empty marker). */
  displayName: string;
  /** Raw popis from the manifest (may be empty or the "BezPoznámky"
   *  marker) — seeds the web-caption note editor. */
  popis: string;
  mesto: string;
  stat: string;
  indikator: "dot" | "radius" | "polygon";
  /** π·r² or polygon area in m², or null for a bare dot. */
  areaM2: number | null;
  radiusM: number | null;
  gpsLat: number;
  gpsLon: number;
  /** Reverse-geocoded address from the manifest, or null. */
  geoAddress: string | null;
  anonymized: boolean;
  /** manifest `zrusena` — the v2 replacement for the v1 NEEXISTUJE- prefix. */
  cancelled: boolean;
  isChild: boolean;
  /** Parent location's id_lokace (potomek), or null when not a child. */
  parentCode: string | null;
  /** Path of the Nosná PNG relative to data/maps/ (e.g.
   *  "Nosné mapy/CZ/Brno/…+00025.png"). */
  nosnaRel: string;
  /** Basename of the Nosná PNG — the admin's per-map identity. */
  nosnaName: string;
  /** Size/mtime of the Nosná PNG; 0/"" + fileMissing when it's absent. */
  size: number;
  mtime: string;
  fileMissing: boolean;
}

/** Absolute path of `data/maps/manifest.json`. */
function manifestPath(): string {
  return path.join(ADMIN_ROOTS.locationMaps, "manifest.json");
}

/** Reads + validates `data/maps/manifest.json` and projects each entry to a
 *  MapInventoryEntry (stat-ing its Nosná PNG). Returns `null` when there's no
 *  manifest at all (a pre-v2 / not-yet-imported data dir) so callers can fall
 *  back to the legacy flat listing. Throws when a manifest exists but is
 *  invalid — that's a real problem the operator must see, not paper over.
 *  Entries are sorted by číslo ascending. */
export async function readMapInventory(): Promise<MapInventoryEntry[] | null> {
  let json: string;
  try {
    json = await fs.readFile(manifestPath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const parsed = parseMapPackageManifest(json);
  if (!parsed.ok) {
    throw new Error(`data/maps/manifest.json je neplatný: ${parsed.error}`);
  }
  const root = ADMIN_ROOTS.locationMaps;
  const entries = await Promise.all(
    parsed.value.mapy.map(async (m) => {
      const nosnaRel = m.soubory["Nosné mapy"];
      let size = 0;
      let mtime = "";
      let fileMissing = false;
      try {
        const st = await fs.stat(path.join(root, nosnaRel));
        size = st.size;
        mtime = st.mtime.toISOString();
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        fileMissing = true;
      }
      return {
        cislo: entryNumber(m),
        code: m.id_lokace,
        displayName: displayNameFor(m),
        popis: m.popis,
        mesto: m.mesto,
        stat: m.stat,
        indikator: m.indikator,
        areaM2: m.aoi_area_m2,
        radiusM: m.radius_m,
        gpsLat: m.gps_lat,
        gpsLon: m.gps_lon,
        geoAddress: m.geo_adresa ?? null,
        anonymized: m.anonymizovana,
        cancelled: m.zrusena,
        isChild: m.potomek !== null,
        parentCode: m.potomek,
        nosnaRel,
        nosnaName: path.basename(nosnaRel),
        size,
        mtime,
        fileMissing,
      } satisfies MapInventoryEntry;
    }),
  );
  entries.sort((a, b) => a.cislo - b.cislo);
  return entries;
}

/** The on-disk Nosná PNG for a v2 map, located by its basename (NFC-aware).
 *  v2 maps live nested under `Nosné mapy/…`, so the flat `resolveDiskPath`
 *  misses them; the admin file endpoint + detail page fall back to this.
 *  Returns null when there's no manifest, no matching entry, or the file is
 *  gone. */
export async function resolveV2MapFileByName(
  name: string,
): Promise<{ name: string; absolutePath: string } | null> {
  const inv = await readMapInventory();
  if (!inv) return null;
  const wantNFC = path.basename(name).normalize("NFC");
  const hit = inv.find((e) => e.nosnaName.normalize("NFC") === wantNFC);
  if (!hit || hit.fileMissing) return null;
  return {
    name: hit.nosnaName,
    absolutePath: path.join(ADMIN_ROOTS.locationMaps, hit.nosnaRel),
  };
}
