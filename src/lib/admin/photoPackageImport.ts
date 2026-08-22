import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { atomicWrite, ensureDir } from "./atomic";
import { ADMIN_ROOTS, safeJoin } from "./paths";
import { prepareTrashDir } from "./trash";
import { readZipEntry } from "./importZip";
import { iterateZipUtf8 } from "./mapPackageImport";
import {
  locationNumber,
  parsePhotoName,
  parsePhotoPackageManifest,
  readPackageTyp,
  storedPhotoName,
  type PhotoPackageManifest,
} from "@/lib/locationPhotoPackage";
import {
  captionsFilePath,
  invalidateCaptionsCache,
  readCaptions,
  type CaptionStore,
} from "@/lib/locationPhotoCaptions";
import { invalidateLocationPhotosCache } from "@/lib/locationPhotos";
import { THUMB_QUALITY, THUMB_SIZE, WEB_QUALITY, WEB_SIZE } from "@/lib/constants";

/**
 * Import of a "fotky-lokaci" package — real photographs of locations, with
 * the clover areas already burned in by the desktop app.
 *
 * Three things make it its own importer rather than a branch of the map
 * one. It writes to `generated/location-photos/` instead of `data/`, so
 * `pnpm sync` is not involved at all — the photos are ready to serve the
 * moment they land. It RE-ENCODES: the package ships 1920×2560 PNGs at
 * ~10 MB each, which is a fine archival master and an impossible thing to
 * put on a public page, so each becomes a WebP pair (web + thumb) exactly
 * like every other image on the site. And it has to reckon with what is
 * already there — a location may hold photos from an earlier import and
 * one from the old manual upload — which is the part the operator has to
 * see BEFORE anything is written.
 *
 * Nothing is destroyed silently: a replaced file goes to `data/.trash/`
 * first, like every other destructive admin action.
 */

const MANIFEST_NAME = "manifest.json";
/** Small variants live one level down so a readdir of the photo directory
 *  never mistakes a thumbnail for another photo. */
const THUMB_SUBDIR = "thumb";

export interface PhotoPackagePhotoPlan {
  /** Path inside the zip. */
  zipPath: string;
  order: number;
  caption: string;
  /** What the file will be called here. */
  storedName: string;
  action: "add" | "replace";
  bytes: number;
  areas: number;
}

export interface PhotoPackageLocationPlan {
  number: string;
  /** Null when the number matches no location — the photos are refused. */
  locationId: number | null;
  locationName: string | null;
  photos: PhotoPackagePhotoPlan[];
  /** Photos already on disk from an earlier import, by filename. */
  existingImported: string[];
  /** Photos uploaded by hand under the old `_reálné foto` convention. */
  existingManual: string[];
}

export interface PhotoPackagePlan {
  totalPhotos: number;
  add: number;
  replace: number;
  totalBytes: number;
  locations: PhotoPackageLocationPlan[];
  /** Numbers in the manifest that match no location in the database. */
  unknownNumbers: string[];
  /** Entries whose filename does not follow `<číslo>_fotoNNN.<ext>`. */
  invalidNames: string[];
  /** Files in the zip the manifest never mentions. */
  orphanFiles: string[];
  warnings: string[];
  createdAt: string | null;
}

export interface PhotoPackageSummary {
  imported: number;
  replaced: number;
  skipped: number;
  /** Manual-upload photos moved to the trash because the operator asked. */
  manualTrashed: number;
  bytesWritten: number;
  errors: string[];
}

export interface PhotoPackageCommitOptions {
  /** What to do when a photo of the same number+order already exists. */
  collision: "overwrite" | "skip";
  /**
   * Also remove the location's hand-uploaded photo when the package brings
   * new ones for it. Off unless the operator ticks it — it deletes
   * something the package did not send, so it can never be a default.
   */
  replaceManual: boolean;
}

function photosDir(): string {
  return ADMIN_ROOTS.locationPhotos;
}

function thumbDir(): string {
  return path.join(photosDir(), THUMB_SUBDIR);
}

/** Reads the manifest without unpacking anything. */
async function readManifest(
  zipPath: string,
): Promise<
  | { ok: true; manifest: PhotoPackageManifest }
  | { ok: false; error: string }
  | null
> {
  let buf: Buffer | null = null;
  await iterateZipUtf8(zipPath, async (zp, zip, raw) => {
    if (zp === MANIFEST_NAME) buf = await readZipEntry(zip, raw);
  });
  if (buf === null) return null;
  const text = (buf as Buffer).toString("utf8");
  if (readPackageTyp(text) !== "fotky-lokaci") return null;
  const parsed = parsePhotoPackageManifest(text);
  return parsed.ok
    ? { ok: true, manifest: parsed.value }
    : { ok: false, error: parsed.error };
}

/** True when this zip is a location-photo package. Checked BEFORE the map
 *  package, whose manifest lives at the same path. */
export async function isPhotoPackageZip(zipPath: string): Promise<boolean> {
  return (await readManifest(zipPath)) !== null;
}

/** What is already on disk, grouped by location number. */
async function readExisting(): Promise<{
  imported: Map<string, string[]>;
  manual: Map<string, string[]>;
}> {
  const imported = new Map<string, string[]>();
  const manual = new Map<string, string[]>();
  let names: string[] = [];
  try {
    names = await fs.readdir(photosDir());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return { imported, manual };
  }
  for (const raw of names) {
    const name = raw.normalize("NFC");
    if (name.startsWith(".") || name === THUMB_SUBDIR) continue;
    const pkg = parsePhotoName(name);
    if (pkg) {
      push(imported, pkg.number, name);
      continue;
    }
    // Manual convention: `<map basename>_reálné foto….ext`, whose stem ends
    // in the same five-digit number.
    const stem = name.slice(0, name.length - path.extname(name).length);
    const idx = stem.indexOf("_reálné foto");
    if (idx <= 0) continue;
    const m = /(?:^|[^0-9])(\d{5})$/.exec(stem.slice(0, idx));
    if (m) push(manual, m[1]!, name);
  }
  return { imported, manual };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Read-only analysis. Writes nothing, and answers the two questions the
 * operator actually has: which locations is this for, and what will it
 * overwrite.
 */
export async function analyzePhotoPackageZip(
  zipPath: string,
): Promise<PhotoPackagePlan | { error: string }> {
  const r = await readManifest(zipPath);
  if (r === null) return { error: "ZIP není balíček fotek lokací." };
  if (!r.ok) return { error: `Neplatný manifest.json: ${r.error}` };
  const manifest = r.manifest;

  // Sizes come from the zip's own directory, so nothing is unpacked.
  const inZip = new Map<string, number>();
  await iterateZipUtf8(zipPath, async (zp, _zip, raw) => {
    inZip.set(zp, raw.uncompressedSize);
  });

  const { imported, manual } = await readExisting();
  const numbers = [...new Set(manifest.fotky.map((f) => f.cislo_lokace))];
  const rows = await prisma.location.findMany({
    where: { id: { in: numbers.map(Number) } },
    select: { id: true, displayName: true, code: true },
  });
  const known = new Map(rows.map((l) => [locationNumber(l.id), l]));

  const byNumber = new Map<string, PhotoPackageLocationPlan>();
  const invalidNames: string[] = [];
  const unknownNumbers: string[] = [];
  const warnings: string[] = [];
  let totalBytes = 0;

  for (const entry of manifest.fotky) {
    const base = path.basename(entry.soubor);
    const parsed = parsePhotoName(base);
    if (!parsed || parsed.number !== entry.cislo_lokace) {
      invalidNames.push(entry.soubor);
      continue;
    }
    const bytes = inZip.get(entry.soubor);
    if (bytes === undefined) {
      warnings.push(`Manifest zmiňuje ${entry.soubor}, ale v ZIPu není.`);
      continue;
    }
    const loc = known.get(entry.cislo_lokace) ?? null;
    if (!loc && !unknownNumbers.includes(entry.cislo_lokace)) {
      unknownNumbers.push(entry.cislo_lokace);
    }
    let plan = byNumber.get(entry.cislo_lokace);
    if (!plan) {
      plan = {
        number: entry.cislo_lokace,
        locationId: loc?.id ?? null,
        locationName: loc ? (loc.displayName || loc.code) : null,
        photos: [],
        existingImported: imported.get(entry.cislo_lokace) ?? [],
        existingManual: manual.get(entry.cislo_lokace) ?? [],
      };
      byNumber.set(entry.cislo_lokace, plan);
    }
    const storedName = storedPhotoName(entry.cislo_lokace, entry.poradi);
    plan.photos.push({
      zipPath: entry.soubor,
      order: entry.poradi,
      caption: entry.popisek,
      storedName,
      action: plan.existingImported.includes(storedName) ? "replace" : "add",
      bytes,
      areas: entry.pocet_ploch,
    });
    totalBytes += bytes;
  }

  // Files shipped but never listed — the manifest is the contract, so they
  // are reported and left alone rather than guessed at.
  const listed = new Set(manifest.fotky.map((f) => f.soubor));
  const orphanFiles = [...inZip.keys()].filter(
    (zp) => zp !== MANIFEST_NAME && !listed.has(zp),
  );

  const locations = [...byNumber.values()].sort((a, b) =>
    a.number.localeCompare(b.number),
  );
  for (const l of locations) {
    l.photos.sort((a, b) => a.order - b.order);
  }
  const all = locations.flatMap((l) => l.photos);

  if (manifest.plochy_vypalene === false) {
    warnings.push(
      "Manifest říká, že plochy NEJSOU vypálené — web je nekreslí, fotky se nahrají tak, jak přišly.",
    );
  }

  return {
    totalPhotos: all.length,
    add: all.filter((p) => p.action === "add").length,
    replace: all.filter((p) => p.action === "replace").length,
    totalBytes,
    locations,
    unknownNumbers,
    invalidNames,
    orphanFiles,
    warnings,
    createdAt: manifest.vytvoreno ?? null,
  };
}

/**
 * Writes the package.
 *
 * Every photo becomes two WebPs — a 1600 px one for the page and a 400 px
 * thumbnail for the gallery — under the same name the package used, so a
 * re-import lands on the same file rather than piling up copies. Anything
 * being replaced is copied to the trash first.
 */
export async function commitPhotoPackageZip(
  zipPath: string,
  opts: PhotoPackageCommitOptions,
): Promise<PhotoPackageSummary> {
  const summary: PhotoPackageSummary = {
    imported: 0,
    replaced: 0,
    skipped: 0,
    manualTrashed: 0,
    bytesWritten: 0,
    errors: [],
  };

  const plan = await analyzePhotoPackageZip(zipPath);
  if ("error" in plan) {
    summary.errors.push(plan.error);
    return summary;
  }

  const wanted = new Map<string, PhotoPackagePhotoPlan & { number: string }>();
  for (const loc of plan.locations) {
    // A location the database does not know gets nothing: a photo keyed to
    // a number with no location would be invisible and unfindable.
    if (loc.locationId === null) {
      summary.skipped += loc.photos.length;
      continue;
    }
    for (const p of loc.photos) wanted.set(p.zipPath, { ...p, number: loc.number });
  }

  await ensureDir(photosDir());
  await ensureDir(thumbDir());
  const sharp = (await import("sharp")).default;
  let trashDir: string | null = null;
  const trash = async (absolute: string, name: string) => {
    trashDir ??= await prepareTrashDir("location-photos");
    await fs.copyFile(absolute, path.join(trashDir, name));
  };

  const captions: CaptionStore = structuredClone(await readCaptions());

  await iterateZipUtf8(zipPath, async (zp, zip, raw) => {
    const target = wanted.get(zp);
    if (!target) return;
    const dest = safeJoin("locationPhotos", target.storedName);
    const thumbDest = safeJoin(
      "locationPhotos",
      path.join(THUMB_SUBDIR, target.storedName),
    );
    try {
      const exists = await fs
        .access(dest)
        .then(() => true)
        .catch(() => false);
      if (exists && opts.collision === "skip") {
        summary.skipped += 1;
        return;
      }
      const source = await readZipEntry(zip, raw);
      // failOn: "none" — a package photo is the operator's own file, and a
      // warning inside an otherwise readable PNG must not lose it.
      const web = await sharp(source, { failOn: "none" })
        .rotate()
        .resize({ width: WEB_SIZE, height: WEB_SIZE, fit: "inside", withoutEnlargement: true })
        .webp({ quality: WEB_QUALITY })
        .toBuffer();
      const thumb = await sharp(source, { failOn: "none" })
        .rotate()
        .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: "inside", withoutEnlargement: true })
        .webp({ quality: THUMB_QUALITY })
        .toBuffer();

      if (exists) await trash(dest, target.storedName);
      await atomicWrite(dest, web);
      await atomicWrite(thumbDest, thumb);
      summary.bytesWritten += web.byteLength + thumb.byteLength;
      if (exists) summary.replaced += 1;
      else summary.imported += 1;

      const forNumber = (captions[target.number] ??= {});
      if (target.caption) forNumber[String(target.order)] = target.caption;
      else delete forNumber[String(target.order)];
      if (Object.keys(forNumber).length === 0) delete captions[target.number];
    } catch (err) {
      summary.errors.push(`${zp}: ${(err as Error).message}`);
    }
  });

  // The hand-uploaded photo of a location the package just refreshed —
  // only when asked, and only for locations this package actually touched.
  if (opts.replaceManual) {
    for (const loc of plan.locations) {
      if (loc.locationId === null || loc.photos.length === 0) continue;
      for (const name of loc.existingManual) {
        try {
          const abs = safeJoin("locationPhotos", name);
          await trash(abs, name);
          await fs.unlink(abs);
          summary.manualTrashed += 1;
        } catch (err) {
          summary.errors.push(`${name}: ${(err as Error).message}`);
        }
      }
    }
  }

  try {
    await ensureDir(path.dirname(captionsFilePath()));
    await atomicWrite(
      captionsFilePath(),
      `${JSON.stringify(captions, null, 2)}\n`,
    );
  } catch (err) {
    summary.errors.push(`popisky: ${(err as Error).message}`);
  }

  invalidateLocationPhotosCache();
  invalidateCaptionsCache();
  return summary;
}
