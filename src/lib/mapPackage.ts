/**
 * Reader + normalizer for the location-map **v2 web package** (`manifest.json`
 * + `Nosné mapy/` + `Rendered mapy/`), produced by the desktop map tool.
 *
 * The manifest is the single source of truth for a v2 map — the web no longer
 * parses GPS/zoom out of the filename or reads PNG tEXt chunks. This module
 * validates the manifest (Zod) and maps each entry to the shape the sync
 * script writes into `locations` / `location_maps`, including the v2 columns
 * added in the phase-A migration.
 *
 * Key conversions handled here so the sync script stays simple:
 *  - `aoi_polygon_gps` is `[lat, lon]`; PostGIS wants `[lon, lat]`.
 *  - image_bounds uses **render_zoom** (not zoom) + output pixel dims, because
 *    the PNG is rendered at render_zoom — using zoom would scale the overlay
 *    wrong (see docs/filename-convention.md).
 *  - display name falls back popis → geo_adresa → id_lokace, so a map whose
 *    popis is the empty "BezPoznámky" marker doesn't surface that as a name.
 *  - `potomek` is the PARENT's id_lokace; we resolve it to the parent's number
 *    via the manifest's own id→číslo map (caller adds a DB fallback).
 */

import { z } from "zod";

/** The "BezPoznámky" marker means "no description" — treat as absent. */
const NO_DESCRIPTION = "BezPoznámky";

/** Reserved číslo for the special "unknown" location (NEZNÁMÁ, id 0). Its
 *  stat/mesto are placeholders the web ignores, so it's exempt from the
 *  strict 2-char stat + non-empty mesto checks that all other entries pass. */
export const UNKNOWN_LOCATION_CISLO = "00000";

/** One map entry as it appears in manifest.json (v2, schema_metadat = 2). */
export const MapPackageEntrySchema = z.object({
  cislo: z.string().regex(/^\d{1,5}$/),
  id_lokace: z.string().min(1),
  popis: z.string(),
  // Lenient at the schema level so the special 00000 entry (placeholder
  // stat/mesto) parses; the strict 2-char stat + non-empty mesto rule is
  // enforced per-entry (except 00000) in parseMapPackageManifest below.
  stat: z.string(),
  mesto: z.string(),
  gps_lat: z.number(),
  gps_lon: z.number(),
  zoom: z.number().int(),
  render_zoom: z.number().int(),
  output_w_px: z.number().int().positive(),
  output_h_px: z.number().int().positive(),
  output_dpi: z.number().int().positive().nullable().optional(),
  // Desktop generator's indicator, priority polygon > radius > dot:
  //   "polygon" — has an AOI polygon (rádius ignored)
  //   "radius"  — point with radius_m (area = π·r²)   [was mislabelled "circle"]
  //   "dot"     — bare point, no radius, no area
  indikator: z.enum(["dot", "radius", "polygon"]),
  radius_m: z.number().nullable(),
  // GPS ring as [lat, lon] pairs, or null for non-polygon indicators.
  aoi_polygon_gps: z.array(z.tuple([z.number(), z.number()])).nullable(),
  aoi_area_m2: z.number().nullable(),
  anonymizovana: z.boolean(),
  zrusena: z.boolean(),
  rodicovska: z.boolean(),
  // Parent location's id_lokace (string), or null when this isn't a child.
  potomek: z.string().nullable(),
  geo_adresa: z.string().nullable().optional(),
  soubory: z.object({
    "Nosné mapy": z.string(),
    "Rendered mapy": z.string().optional(),
  }),
  // Fields the package carries for its own diffing — ignored by the web.
  duvod: z.unknown().optional(),
  rozdily_vuci_webu: z.unknown().optional(),
});
export type MapPackageEntry = z.infer<typeof MapPackageEntrySchema>;

export const MapPackageManifestSchema = z.object({
  typ: z.literal("lokacni-mapy"),
  schema_metadat: z.literal(2),
  vytvoreno: z.string().optional(),
  pocet_map: z.number().int().optional(),
  mapy: z.array(MapPackageEntrySchema),
});
export type MapPackageManifest = z.infer<typeof MapPackageManifestSchema>;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Parses + validates a manifest.json string. Normalizes id_lokace, popis and
 * geo_adresa to NFC (macOS filenames/JSON often arrive NFD, which breaks
 * string equality against our NFC constants and DB rows).
 */
export function parseMapPackageManifest(
  json: string,
): ParseResult<MapPackageManifest> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  const parsed = MapPackageManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  // Strict per-entry rules Zod can't express conditionally: every entry
  // EXCEPT the special 00000 (unknown location, placeholder stat/mesto) must
  // carry a 2-char country code + a non-empty city.
  for (const m of parsed.data.mapy) {
    if (m.cislo === UNKNOWN_LOCATION_CISLO) continue;
    if (m.stat.length !== 2) {
      return {
        ok: false,
        error: `mapy (${m.cislo}): stat musí mít přesně 2 znaky (má ${m.stat.length})`,
      };
    }
    if (m.mesto.trim().length === 0) {
      return { ok: false, error: `mapy (${m.cislo}): mesto nesmí být prázdné` };
    }
  }
  for (const m of parsed.data.mapy) {
    m.id_lokace = m.id_lokace.normalize("NFC");
    m.popis = m.popis.normalize("NFC");
    if (m.geo_adresa) m.geo_adresa = m.geo_adresa.normalize("NFC");
    m.mesto = m.mesto.normalize("NFC");
    // File paths carry diacritics too (…/Ratiboř/…) and must match the NFC
    // form both the zip iterator and the on-disk (Linux VPS) files use —
    // otherwise sync's join(mapsDir, soubory) misses the staged file.
    m.soubory["Nosné mapy"] = m.soubory["Nosné mapy"].normalize("NFC");
    if (m.soubory["Rendered mapy"]) {
      m.soubory["Rendered mapy"] = m.soubory["Rendered mapy"].normalize("NFC");
    }
  }
  return { ok: true, value: parsed.data };
}

/** Number (PK) for a map entry: "00210" → 210. */
export function entryNumber(entry: MapPackageEntry): number {
  return Number(entry.cislo);
}

/** Human display name: popis, unless it's absent/the empty marker. */
export function displayNameFor(entry: MapPackageEntry): string {
  const popis = entry.popis.trim();
  if (popis && popis !== NO_DESCRIPTION) return popis;
  const addr = entry.geo_adresa?.trim();
  if (addr) return addr;
  return entry.id_lokace;
}

/**
 * PostGIS WKT for the AOI polygon, or null. Input rings are [lat, lon];
 * WKT is "lon lat", and the ring is closed if the generator didn't.
 */
export function polygonWkt(entry: MapPackageEntry): string | null {
  const ring = entry.aoi_polygon_gps;
  if (!ring || ring.length < 3) return null;
  const pts = ring.map(([lat, lon]) => `${lon} ${lat}`);
  const [firstLat, firstLon] = ring[0]!;
  const [lastLat, lastLon] = ring[ring.length - 1]!;
  if (firstLat !== lastLat || firstLon !== lastLon) {
    pts.push(`${firstLon} ${firstLat}`);
  }
  return `POLYGON((${pts.join(", ")}))`;
}

/**
 * Resolve a child's parent number from its `potomek` (parent id_lokace).
 * First via the manifest's own id→číslo map; the sync caller passes a
 * `dbFallback` that looks up locations.code when the parent isn't in this
 * package. Returns null for non-children or unresolved parents.
 */
export function resolveParentNumber(
  entry: MapPackageEntry,
  idToNumber: ReadonlyMap<string, number>,
  dbFallback?: (parentIdLokace: string) => number | null,
): number | null {
  if (!entry.potomek) return null;
  const inPkg = idToNumber.get(entry.potomek);
  if (inPkg != null) return inPkg;
  return dbFallback?.(entry.potomek) ?? null;
}

/**
 * Merges an incoming manifest into an existing one, keyed by číslo (incoming
 * wins per map). Result is sorted by číslo and carries the incoming manifest's
 * top-level fields with `pocet_map` recomputed.
 *
 * A package can legitimately carry a SUBSET of the collection, so an import
 * must be ADDITIVE: replacing the inventory with a subset would orphan every
 * other location on the next sync. Pass `existing = null` for a first import.
 */
export function mergeManifests(
  existing: MapPackageManifest | null,
  incoming: MapPackageManifest,
): { manifest: MapPackageManifest; added: number; replaced: number } {
  const byCislo = new Map<number, MapPackageEntry>();
  for (const m of existing?.mapy ?? []) byCislo.set(entryNumber(m), m);
  let added = 0;
  let replaced = 0;
  for (const m of incoming.mapy) {
    const n = entryNumber(m);
    if (byCislo.has(n)) replaced++;
    else added++;
    byCislo.set(n, m);
  }
  return {
    manifest: {
      ...incoming,
      pocet_map: byCislo.size,
      mapy: [...byCislo.values()].sort(
        (a, b) => entryNumber(a) - entryNumber(b),
      ),
    },
    added,
    replaced,
  };
}

/** id_lokace → číslo map across a manifest, for parent resolution. */
export function buildIdToNumber(
  manifest: MapPackageManifest,
): Map<string, number> {
  return new Map(manifest.mapy.map((m) => [m.id_lokace, entryNumber(m)]));
}
