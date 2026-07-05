import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import piexif from "piexifjs";
import { prisma } from "@/lib/db";
import { generateWebPVariants, type WatermarkSpec } from "@/lib/images";
import {
  DEFAULT_WATERMARK_OPTIONS,
  getWatermarkBuffer,
} from "@/lib/watermark";
import { atomicWrite, ensureDir, trashTimestamp } from "./atomic";
import { ADMIN_ROOTS, GENERATED_ROOT, safeBaseName } from "./paths";

/**
 * Re-crop a find's CROP image from its ORIGINAL. The admin selects a square
 * region over the upright photo (fractions of width/height); this extracts
 * that square from the full-resolution original, preserves the original's
 * EXIF GPS + capture date (orientation reset to 1 since the pixels are baked
 * upright), replaces the crop file in place, regenerates its watermarked
 * WebP variants and updates the `find_images` CROP row so the change is live
 * immediately — admin is the source of truth here (§CLAUDE.md admin rules).
 *
 * Safety: the previous crop is copied to `data/.trash/<ts>/crops/` before it
 * is overwritten, so a bad crop is always recoverable.
 */

/** Square selection, expressed as fractions of the UPRIGHT image:
 *  `x`,`y` = top-left corner (0..1 of width / height), `size` = side length
 *  as a fraction of the width. The server clamps everything into bounds. */
export interface CropRegion {
  x: number;
  y: number;
  size: number;
}

export interface RecropResult {
  ok: boolean;
  error?: string;
  /** New crop dimensions on success, for a quick confirmation in the UI. */
  width?: number;
  height?: number;
}

function isFrac(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}

/** EXIF orientations 5–8 store the image rotated 90°, so the upright
 *  (auto-oriented) dimensions are the stored ones swapped. */
function uprightDims(
  width: number,
  height: number,
  orientation: number | undefined,
): { w: number; h: number } {
  return orientation !== undefined && orientation >= 5
    ? { w: height, h: width }
    : { w: width, h: height };
}

/** Copy GPS + capture-date EXIF from the original JPEG onto the freshly
 *  cropped JPEG, forcing orientation to 1 (pixels are already upright).
 *  Best-effort: returns the untouched crop if the original carries no
 *  parseable EXIF. */
function preserveExif(originalJpeg: Buffer, croppedJpeg: Buffer): Buffer {
  try {
    const src = piexif.load(originalJpeg.toString("binary"));
    const zeroth: Record<number, unknown> = {
      [piexif.ImageIFD.Orientation]: 1,
    };
    const dt = src["0th"]?.[piexif.ImageIFD.DateTime];
    if (dt !== undefined) zeroth[piexif.ImageIFD.DateTime] = dt;

    const exifIfd: Record<number, unknown> = {};
    for (const tag of [
      piexif.ExifIFD.DateTimeOriginal,
      piexif.ExifIFD.DateTimeDigitized,
      piexif.ExifIFD.OffsetTime,
      piexif.ExifIFD.OffsetTimeOriginal,
      piexif.ExifIFD.SubSecTimeOriginal,
    ]) {
      const v = src["Exif"]?.[tag];
      if (v !== undefined) exifIfd[tag] = v;
    }

    const exifBytes = piexif.dump({
      "0th": zeroth,
      Exif: exifIfd,
      GPS: src["GPS"] ?? {},
    });
    const inserted = piexif.insert(
      exifBytes,
      `data:image/jpeg;base64,${croppedJpeg.toString("base64")}`,
    );
    // insert() echoes the input shape — a data URL in, a data URL out.
    return Buffer.from(inserted.split(",", 2)[1] ?? "", "base64");
  } catch {
    return croppedJpeg;
  }
}

/** Load the collection watermark, matching `scripts/sync.ts`. Missing file
 *  (dev, or not yet uploaded) → null, so we still produce bare WebPs. */
async function loadWatermark(): Promise<WatermarkSpec | null> {
  try {
    const buffer = await getWatermarkBuffer(
      path.join(ADMIN_ROOTS.meta, "VODOZNAK_BezJmena.png"),
      DEFAULT_WATERMARK_OPTIONS,
    );
    return { buffer, options: DEFAULT_WATERMARK_OPTIONS };
  } catch {
    return null;
  }
}

export async function recropFind(
  findId: number,
  region: CropRegion,
): Promise<RecropResult> {
  if (!Number.isInteger(findId) || findId <= 0) {
    return { ok: false, error: "Neplatné ID nálezu" };
  }
  if (!isFrac(region.x) || !isFrac(region.y) || !isFrac(region.size) || region.size <= 0) {
    return { ok: false, error: "Neplatná oblast ořezu" };
  }

  const images = await prisma.findImage.findMany({
    where: { findId, imageType: { in: ["ORIGINAL", "CROP"] } },
    select: { imageType: true, originalFilename: true },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
  });
  const original = images.find((i) => i.imageType === "ORIGINAL");
  const crop = images.find((i) => i.imageType === "CROP");
  if (!original) return { ok: false, error: "Nález nemá originál" };
  if (!crop) return { ok: false, error: "Nález nemá ořez" };

  let origName: string;
  let cropName: string;
  try {
    origName = safeBaseName(original.originalFilename);
    cropName = safeBaseName(crop.originalFilename);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const origPath = path.join(ADMIN_ROOTS.findOriginals, origName);
  const cropPath = path.join(ADMIN_ROOTS.findCrops, cropName);

  let origBuf: Buffer;
  try {
    origBuf = await fs.readFile(origPath);
  } catch {
    return { ok: false, error: `Originál na disku chybí: ${origName}` };
  }

  // Upright geometry → the selection fractions map straight onto it.
  const meta = await sharp(origBuf).metadata();
  if (!meta.width || !meta.height) {
    return { ok: false, error: "Nelze přečíst rozměry originálu" };
  }
  const up = uprightDims(meta.width, meta.height, meta.orientation);

  // Clamp the requested square into the image.
  let side = Math.round(region.size * up.w);
  let left = Math.round(region.x * up.w);
  let top = Math.round(region.y * up.h);
  side = Math.max(1, Math.min(side, up.w - left, up.h - top));
  left = Math.max(0, Math.min(left, up.w - side));
  top = Math.max(0, Math.min(top, up.h - side));

  let croppedJpeg: Buffer;
  try {
    croppedJpeg = await sharp(origBuf)
      .rotate() // auto-orient upright BEFORE extract
      .extract({ left, top, width: side, height: side })
      .jpeg({ quality: 95 })
      .toBuffer();
  } catch (e) {
    return { ok: false, error: `Ořez selhal: ${(e as Error).message}` };
  }
  const finalJpeg = preserveExif(origBuf, croppedJpeg);

  // Snapshot the current crop to the trash before overwriting it.
  try {
    const trashDir = path.join(ADMIN_ROOTS.trash, trashTimestamp(), "crops");
    await ensureDir(trashDir);
    await fs.copyFile(cropPath, path.join(trashDir, cropName));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      return { ok: false, error: `Zálohu ořezu nelze vytvořit: ${(e as Error).message}` };
    }
  }

  // Replace the crop source, then regenerate its watermarked WebP variants.
  await atomicWrite(cropPath, finalJpeg);
  const watermark = await loadWatermark();
  await ensureDir(path.join(GENERATED_ROOT, "web"));
  await ensureDir(path.join(GENERATED_ROOT, "thumb"));
  const generated = await generateWebPVariants({
    sourcePath: cropPath,
    generatedDir: GENERATED_ROOT,
    forceRegen: true, // new bytes + re-bake the watermark
    watermark,
  });

  // Point the CROP row at the new variants — live immediately.
  await prisma.findImage.updateMany({
    where: { findId, imageType: "CROP" },
    data: {
      originalSha1: generated.sha1,
      webPath: generated.webPath,
      thumbPath: generated.thumbPath,
      width: generated.width,
      height: generated.height,
    },
  });

  return { ok: true, width: generated.width, height: generated.height };
}
