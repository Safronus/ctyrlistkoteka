import { z } from "zod";

/**
 * The "fotky-lokaci" package — real photographs of a location, with the
 * areas where clovers grow already burned into the image.
 *
 * Contract with the desktop app (its docs/WEB_predani_fotek_lokaci.md):
 *
 *     manifest.json
 *     location-photos/00126/00126_foto001.png
 *
 * The join key is the five-digit LOCATION NUMBER, and deliberately nothing
 * else: `id_lokace` is editable and the town can change under a
 * re-geocode, so anything derived from either would orphan itself. On this
 * side that number is `locations.id` / `location_maps.id` — the MAP_ID the
 * rest of the site already keys location photos by.
 *
 * The web draws nothing: the areas arrive burned in, each with its own
 * opacity. The photo's `tEXt` metadata are documented to survive the
 * burn-in, but the first real package shipped without them — so nothing
 * here may depend on the PNG carrying anything. Everything needed is in
 * the manifest.
 */

/** `00126_foto002.png` — location number, then the photo's order. */
export const PHOTO_NAME_RE = /^(\d{5})_foto(\d{3,})\.(png|jpe?g|webp)$/i;

const PhotoEntrySchema = z.object({
  cislo_lokace: z.string().regex(/^\d{5}$/, "číslo lokace musí mít 5 číslic"),
  soubor: z.string().min(1),
  poradi: z.number().int().positive(),
  popisek: z.string().optional().default(""),
  pocet_ploch: z.number().int().nonnegative().optional().default(0),
  plochy_vypalene: z.boolean().optional().default(true),
});
export type PhotoPackageEntry = z.infer<typeof PhotoEntrySchema>;

export const PhotoPackageManifestSchema = z.object({
  typ: z.literal("fotky-lokaci"),
  schema_metadat: z.literal(1),
  vytvoreno: z.string().optional(),
  pocet_fotek: z.number().int().nonnegative().optional(),
  plochy_vypalene: z.boolean().optional(),
  originaly_prilozeny: z.boolean().optional(),
  fotky: z.array(PhotoEntrySchema),
});
export type PhotoPackageManifest = z.infer<typeof PhotoPackageManifestSchema>;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Parses and validates a manifest.
 *
 * Strings are NFC-normalised: a caption typed on macOS arrives decomposed,
 * and the same text would then compare unequal to itself after a round
 * trip through the captions file — the project's oldest trap.
 */
export function parsePhotoPackageManifest(
  json: string,
): ParseResult<PhotoPackageManifest> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `nečitelný JSON (${(e as Error).message})` };
  }
  const parsed = PhotoPackageManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first
        ? `${first.path.join(".") || "manifest"}: ${first.message}`
        : "neplatný manifest",
    };
  }
  return {
    ok: true,
    value: {
      ...parsed.data,
      fotky: parsed.data.fotky.map((f) => ({
        ...f,
        soubor: f.soubor.normalize("NFC"),
        popisek: f.popisek.normalize("NFC").trim(),
      })),
    },
  };
}

/** The `typ` field alone, for deciding which importer a package belongs to.
 *  Tolerant on purpose: a manifest this build cannot validate must still be
 *  routable, so the operator gets "invalid photo manifest" rather than the
 *  map importer's confusing complaint. */
export function readPackageTyp(json: string): string | null {
  try {
    const raw = JSON.parse(json) as { typ?: unknown };
    return typeof raw.typ === "string" ? raw.typ : null;
  } catch {
    return null;
  }
}

export interface ParsedPhotoName {
  /** Five digits, leading zeros kept — the join key as text. */
  number: string;
  /** Same number as an integer, which is what the database stores. */
  locationId: number;
  order: number;
}

/** Reads a package photo's filename. Returns null for anything else, so a
 *  stray file in the zip is reported rather than guessed at. */
export function parsePhotoName(name: string): ParsedPhotoName | null {
  const m = PHOTO_NAME_RE.exec(name.normalize("NFC"));
  if (!m) return null;
  const number = m[1]!;
  const order = Number(m[2]);
  if (!Number.isInteger(order) || order <= 0) return null;
  return { number, locationId: Number(number), order };
}

/**
 * What the photo is stored as on this side: the same name, as WebP.
 *
 * Kept identical to the package's so the two can be matched by eye during
 * an import, and so a re-import of the same photo lands on the same file
 * instead of piling up copies.
 */
export function storedPhotoName(number: string, order: number): string {
  return `${number}_foto${String(order).padStart(3, "0")}.webp`;
}

/** Five-digit form of a location id, the way the package writes it. */
export function locationNumber(locationId: number): string {
  return String(locationId).padStart(5, "0");
}
