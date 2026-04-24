/* eslint-disable @typescript-eslint/no-require-imports */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { THUMB_QUALITY, THUMB_SIZE, WEB_QUALITY, WEB_SIZE } from "./constants";

export interface GeneratedImage {
  sha1: string;
  webPath: string;
  thumbPath: string;
  /** Size of the web-resolution WebP (limiting edge = WEB_SIZE). */
  width: number;
  height: number;
  /** Format detected from magic bytes ("heic" / "jpeg" / "png" / "unknown"). */
  sourceFormat: string;
}

/**
 * Content-hash a file without loading it fully into memory.
 */
export async function sha1File(path: string): Promise<string> {
  const h = createHash("sha1");
  return await new Promise((resolve, reject) => {
    const s = createReadStream(path);
    s.on("error", reject);
    s.on("data", (chunk) => h.update(chunk));
    s.on("end", () => resolve(h.digest("hex")));
  });
}

/**
 * Detect image format from the first bytes of a buffer. Per
 * docs/filename-convention.md §B: some map files are labeled .png but are
 * actually JPEG — we can't trust the extension.
 */
export function detectFormat(buf: Buffer): "heic" | "jpeg" | "png" | "unknown" {
  if (buf.length < 12) return "unknown";
  // HEIC/HEIF: "ftyp" at offset 4, then heic/heix/mif1/msf1/hevc variants
  if (
    buf[4] === 0x66 &&
    buf[5] === 0x74 &&
    buf[6] === 0x79 &&
    buf[7] === 0x70
  ) {
    const brand = buf.slice(8, 12).toString("ascii");
    if (
      brand === "heic" ||
      brand === "heix" ||
      brand === "mif1" ||
      brand === "msf1" ||
      brand === "hevc"
    ) {
      return "heic";
    }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "png";
  }
  return "unknown";
}

/**
 * Generates both the web (~1600 px) and thumb (~400 px) WebP variants for a
 * single source file. Uses deterministic SHA-1 naming so output is
 * idempotent: if both files already exist and no regen is requested, returns
 * the existing metadata without doing work.
 *
 * sharp and heic-convert are `require`d lazily so that the import cost is
 * only paid when generation actually runs (dry-run stays fast).
 */
export async function generateWebPVariants(params: {
  sourcePath: string;
  generatedDir: string;
  forceRegen?: boolean;
  sha1?: string;
}): Promise<GeneratedImage> {
  const { sourcePath, generatedDir, forceRegen = false } = params;
  const sha1 = params.sha1 ?? (await sha1File(sourcePath));

  const webPath = join(generatedDir, "web", `${sha1}.webp`);
  const thumbPath = join(generatedDir, "thumb", `${sha1}.webp`);

  // Fast path: both outputs already present.
  if (!forceRegen && (await exists(webPath)) && (await exists(thumbPath))) {
    // Lazy-load sharp only for metadata
    const sharp = require("sharp") as typeof import("sharp");
    const meta = await sharp(webPath).metadata();
    return {
      sha1,
      webPath,
      thumbPath,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      sourceFormat: "cached",
    };
  }

  await mkdir(dirname(webPath), { recursive: true });
  await mkdir(dirname(thumbPath), { recursive: true });

  const raw = await readFile(sourcePath);
  const format = detectFormat(raw);

  // Get a pipeline for the decoded image. HEIC goes through heic-convert
  // first (sharp's HEIC support requires libvips-heif at build time, which
  // is hit-or-miss on prebuilt binaries).
  let pixelBuffer: Buffer;
  if (format === "heic") {
    const heicConvert = require("heic-convert") as (opts: {
      buffer: Buffer;
      format: "JPEG" | "PNG";
      quality?: number;
    }) => Promise<Buffer>;
    const jpegBuf = await heicConvert({
      buffer: raw,
      format: "JPEG",
      quality: 0.95,
    });
    pixelBuffer = Buffer.from(jpegBuf);
  } else {
    // sharp decodes JPEG/PNG natively (and tolerates the "PNG but actually
    // JPEG" map files since it inspects magic bytes itself).
    pixelBuffer = raw;
  }

  const sharp = require("sharp") as typeof import("sharp");
  // Strip EXIF for privacy: GPS/date/camera info should never leak into
  // publicly-served derived images. They're extracted earlier and stored in
  // the DB; nothing in the WebP needs them.
  const pipeline = sharp(pixelBuffer, { failOn: "none" }).rotate(); // auto-orient via EXIF before strip

  const webBuf = await pipeline
    .clone()
    .resize({
      width: WEB_SIZE,
      height: WEB_SIZE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: WEB_QUALITY })
    .toBuffer({ resolveWithObject: true });

  const thumbBuf = await pipeline
    .clone()
    .resize({
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer({ resolveWithObject: true });

  await Promise.all([
    (await import("node:fs/promises")).writeFile(webPath, webBuf.data),
    (await import("node:fs/promises")).writeFile(thumbPath, thumbBuf.data),
  ]);

  return {
    sha1,
    webPath,
    thumbPath,
    width: webBuf.info.width,
    height: webBuf.info.height,
    sourceFormat: format,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
