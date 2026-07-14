/* eslint-disable @typescript-eslint/no-require-imports */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  MAP_THUMB_QUALITY,
  MAP_THUMB_SIZE,
  THUMB_QUALITY,
  THUMB_SIZE,
  WEB_QUALITY,
  WEB_SIZE,
} from "./constants";
import { compositeWatermarkOnto, type WatermarkOptions } from "./watermark";

export interface GeneratedImage {
  sha1: string;
  /** Public URL — what to put in <img src>. Always begins with /generated/. */
  webPath: string;
  /** Public URL for the small variant. */
  thumbPath: string;
  /** Size of the web-resolution WebP (limiting edge = WEB_SIZE). */
  width: number;
  height: number;
  /** Format detected from magic bytes ("heic" / "jpeg" / "png" / "unknown"). */
  sourceFormat: string;
}

/** Pre-loaded watermark plus the options to render it with. The buffer is
 *  the alpha-masked PNG returned by `getWatermarkBuffer`; callers should
 *  load it once per sync run and pass the same value to every variant
 *  generation so the encode side can reuse it.
 *
 *  When omitted (or null) on a generation call, the variant is encoded
 *  bare — the cached fast-path also returns bare metadata. The script
 *  layer (sync.ts) decides whether to thread a watermark through. */
export interface WatermarkSpec {
  buffer: Buffer;
  options?: WatermarkOptions;
}

/** Public URL the browser uses. Nginx aliases /generated/ → $GENERATED_DIR. */
function publicWebUrl(sha1: string): string {
  return `/generated/web/${sha1}.webp`;
}
function publicThumbUrl(sha1: string): string {
  return `/generated/thumb/${sha1}.webp`;
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
 * Returned `webPath` / `thumbPath` are PUBLIC URLs (e.g.
 * "/generated/web/{sha}.webp"), not filesystem paths — they end up in
 * find_images.web_path/thumb_path and feed straight into <img src>. Nginx
 * (or Next dev) serves /generated/ from the configured generated dir.
 *
 * sharp and heic-convert are `require`d lazily so that the import cost is
 * only paid when generation actually runs (dry-run stays fast).
 */
export async function generateWebPVariants(params: {
  sourcePath: string;
  generatedDir: string;
  forceRegen?: boolean;
  sha1?: string;
  /** Optional watermark to bake into both variants. The fast-path
   *  (cached files on disk) ignores this — once a WebP exists we trust
   *  whatever watermark state it was written with. To re-watermark, the
   *  caller must pass `forceRegen: true`. */
  watermark?: WatermarkSpec | null;
}): Promise<GeneratedImage> {
  const { sourcePath, generatedDir, forceRegen = false, watermark } = params;
  const sha1 = params.sha1 ?? (await sha1File(sourcePath));

  // Filesystem paths used to write/check existence:
  const webFs = join(generatedDir, "web", `${sha1}.webp`);
  const thumbFs = join(generatedDir, "thumb", `${sha1}.webp`);

  // Fast path: both outputs already present.
  if (!forceRegen && (await exists(webFs)) && (await exists(thumbFs))) {
    const sharp = require("sharp") as typeof import("sharp");
    const meta = await sharp(webFs).metadata();
    return {
      sha1,
      webPath: publicWebUrl(sha1),
      thumbPath: publicThumbUrl(sha1),
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      sourceFormat: "cached",
    };
  }

  await mkdir(dirname(webFs), { recursive: true });
  await mkdir(dirname(thumbFs), { recursive: true });

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
  // Post-EXIF-auto-orient display dimensions: orientations 5–8 carry a 90°
  // rotation, so width/height are swapped for display. We look at metadata
  // (cheap, no full decode) rather than resolving the pipeline.
  const meta = await sharp(pixelBuffer, { failOn: "none" }).metadata();
  const swapWH = (meta.orientation ?? 1) >= 5;
  const displayW = swapWH ? (meta.height ?? 0) : (meta.width ?? 0);
  const displayH = swapWH ? (meta.width ?? 0) : (meta.height ?? 0);

  // Strip EXIF for privacy: GPS/date/camera info should never leak into
  // publicly-served derived images. They're extracted earlier and stored in
  // the DB; nothing in the WebP needs them.
  //
  // Unify orientation to PORTRAIT: after EXIF auto-orient, a landscape photo
  // is rotated 90° CW (the same rotation the detail page used to apply in
  // CSS, now baked in). Clover shots are top-down so there's no "up" to get
  // wrong, and baking it means the watermark's bottom-right corner stays
  // bottom-right in every view instead of moving when the detail rotated the
  // display. sharp allows the no-arg EXIF orient PLUS one explicit rotation.
  let pipeline = sharp(pixelBuffer, { failOn: "none" }).rotate();
  if (displayW > displayH) pipeline = pipeline.rotate(90);

  const webBuf = await encodeVariant(
    pipeline,
    WEB_SIZE,
    WEB_QUALITY,
    watermark ?? null,
  );
  const thumbBuf = await encodeVariant(
    pipeline,
    THUMB_SIZE,
    THUMB_QUALITY,
    watermark ?? null,
  );

  const fs = await import("node:fs/promises");
  await Promise.all([
    fs.writeFile(webFs, webBuf.data),
    fs.writeFile(thumbFs, thumbBuf.data),
  ]);

  return {
    sha1,
    webPath: publicWebUrl(sha1),
    thumbPath: publicThumbUrl(sha1),
    width: webBuf.info.width,
    height: webBuf.info.height,
    sourceFormat: format,
  };
}

export interface NormalizedPhoto {
  /** sha1 of the ORIGINAL uploaded bytes — the dedup key + filename stem.
   *  Hashing the source (not the encode) means re-uploading the exact same
   *  file dedups regardless of sharp's encode determinism. */
  sha1: string;
  /** Web-resolution WebP (limiting edge = WEB_SIZE), EXIF stripped. */
  webBuf: Buffer;
  /** Thumbnail WebP (limiting edge = THUMB_SIZE), EXIF stripped. */
  thumbBuf: Buffer;
  width: number;
  height: number;
  sourceFormat: "heic" | "jpeg" | "png" | "unknown";
}

/**
 * Normalizes an arbitrary uploaded photo buffer (HEIC / JPEG / PNG / WebP)
 * into web + thumb WebP buffers — auto-oriented via EXIF then stripped of
 * all metadata (GPS/date/camera never leak into the served derivative).
 * No watermark: donation photos are the donor's own, not our collection
 * imagery. Throws if the bytes don't decode (sharp), which the caller maps
 * to a per-file rejection. Used by the bulk donation-photo assign flow.
 */
export async function normalizeToWebp(original: Buffer): Promise<NormalizedPhoto> {
  const sha1 = createHash("sha1").update(original).digest("hex");
  const format = detectFormat(original);

  let pixelBuffer: Buffer;
  if (format === "heic") {
    const heicConvert = require("heic-convert") as (opts: {
      buffer: Buffer;
      format: "JPEG" | "PNG";
      quality?: number;
    }) => Promise<Buffer>;
    const jpegBuf = await heicConvert({
      buffer: original,
      format: "JPEG",
      quality: 0.95,
    });
    pixelBuffer = Buffer.from(jpegBuf);
  } else {
    // sharp decodes JPEG/PNG/WebP natively; "unknown" (e.g. WebP) still
    // flows here and either decodes or throws → caller rejects that file.
    pixelBuffer = original;
  }

  const sharp = require("sharp") as typeof import("sharp");
  const pipeline = sharp(pixelBuffer, { failOn: "none" }).rotate();
  const web = await pipeline
    .clone()
    .resize({
      width: WEB_SIZE,
      height: WEB_SIZE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: WEB_QUALITY })
    .toBuffer({ resolveWithObject: true });
  const thumb = await pipeline
    .clone()
    .resize({
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer({ resolveWithObject: true });

  return {
    sha1,
    webBuf: web.data,
    thumbBuf: thumb.data,
    width: web.info.width,
    height: web.info.height,
    sourceFormat: format,
  };
}

/**
 * Resizes the source pipeline to the target edge length, applies the
 * watermark when one is provided, and encodes the result as WebP. When
 * `watermark` is null the resize and encode happen in a single sharp
 * pass (fastest path). When set, we materialise the resized image into
 * an intermediate buffer to learn its true dimensions, then composite
 * the watermark in position before encoding — sharp can't expose the
 * post-resize size mid-pipeline without first executing it.
 */
async function encodeVariant(
  pipeline: import("sharp").Sharp,
  size: number,
  quality: number,
  watermark: WatermarkSpec | null,
): Promise<{ data: Buffer; info: import("sharp").OutputInfo }> {
  const resizePipeline = pipeline.clone().resize({
    width: size,
    height: size,
    fit: "inside",
    withoutEnlargement: true,
  });
  if (!watermark) {
    return await resizePipeline
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
  }
  const sharp = require("sharp") as typeof import("sharp");
  const resized = await resizePipeline.toBuffer({ resolveWithObject: true });
  const composited = await compositeWatermarkOnto(
    sharp(resized.data),
    resized.info.width,
    resized.info.height,
    watermark.buffer,
    watermark.options,
  );
  return await composited
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });
}

/**
 * Generates a single WebP variant for a per-location MAP screenshot.
 * Lives at /generated/maps/{sha}.webp publicly. Maps don't need a thumb
 * variant — only one fixed-size overlay is rendered.
 */
export interface GeneratedMapImage {
  sha1: string;
  /** Public URL for the map overlay (matches Nginx /generated/ alias). */
  imageUrl: string;
  width: number;
  height: number;
  sourceFormat: string;
}

export async function generateMapWebP(params: {
  sourcePath: string;
  generatedDir: string;
  forceRegen?: boolean;
  sha1?: string;
}): Promise<GeneratedMapImage> {
  const { sourcePath, generatedDir, forceRegen = false } = params;
  const sha1 = params.sha1 ?? (await sha1File(sourcePath));

  const mapFs = join(generatedDir, "maps", `${sha1}.webp`);
  const mapThumbFs = join(generatedDir, "maps", `${sha1}-thumb.webp`);
  const imageUrl = `/generated/maps/${sha1}.webp`;

  // Small variant for list / sidebar thumbnails (the full map is ~4× too
  // big there). Kept next to the full map as `{sha}-thumb.webp`; the URL is
  // derived by convention on the read side, so no DB column is needed.
  const writeMapThumb = async (source: Buffer | string): Promise<void> => {
    const sharp = require("sharp") as typeof import("sharp");
    const thumb = await sharp(source, { failOn: "none" })
      .resize({
        width: MAP_THUMB_SIZE,
        height: MAP_THUMB_SIZE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: MAP_THUMB_QUALITY })
      .toBuffer();
    const fs = await import("node:fs/promises");
    await fs.writeFile(mapThumbFs, thumb);
  };

  if (!forceRegen && (await exists(mapFs))) {
    const sharp = require("sharp") as typeof import("sharp");
    const meta = await sharp(mapFs).metadata();
    // Backfill the thumbnail for maps generated before thumbs existed, so a
    // plain (non-forced) sync fills them in incrementally.
    if (!(await exists(mapThumbFs))) await writeMapThumb(mapFs);
    return {
      sha1,
      imageUrl,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      sourceFormat: "cached",
    };
  }

  await mkdir(dirname(mapFs), { recursive: true });

  // Maps are PNG/JPEG — sharp handles both. They contain text labels so
  // quality matters more than file size; aim higher than the default.
  const sharp = require("sharp") as typeof import("sharp");
  const raw = await readFile(sourcePath);
  const format = detectFormat(raw);
  const out = await sharp(raw, { failOn: "none" })
    .webp({ quality: 88 })
    .toBuffer({ resolveWithObject: true });

  const fs = await import("node:fs/promises");
  await fs.writeFile(mapFs, out.data);
  await writeMapThumb(out.data);

  return {
    sha1,
    imageUrl,
    width: out.info.width,
    height: out.info.height,
    sourceFormat: format,
  };
}

/**
 * Computes the LatLng bounds of a map screenshot from its pixel size and
 * the GPS centre / zoom level encoded in the filename. Pure math, no I/O.
 * Same formula as docs/filename-convention.md §B.
 */
export function computeMapBounds(params: {
  centerLat: number;
  centerLng: number;
  zoom: number;
  width: number;
  height: number;
}): [[number, number], [number, number]] {
  const { centerLat, centerLng, zoom, width, height } = params;
  const resolution =
    (156543.03 * Math.cos((centerLat * Math.PI) / 180)) / 2 ** zoom;
  const widthM = width * resolution;
  const heightM = height * resolution;
  const dLat = heightM / 111320;
  const dLng = widthM / (111320 * Math.cos((centerLat * Math.PI) / 180));
  return [
    [centerLat - dLat / 2, centerLng - dLng / 2],
    [centerLat + dLat / 2, centerLng + dLng / 2],
  ];
}

/**
 * Reads PNG textual metadata chunks (tEXt + iTXt) and returns them as a
 * keyword→value map. Used to extract the AOI_POLYGON JSON written by the
 * map-generator tool.
 *
 * PNG layout: 8-byte signature, then chunks of {length(4) type(4)
 * data(length) crc(4)}. tEXt is keyword + 0x00 + latin1 text; iTXt has
 * additional language/translated-keyword fields then UTF-8 text.
 */
export function parsePngTextChunks(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  if (
    buf.length < 8 ||
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47
  ) {
    return out;
  }
  let off = 8;
  while (off + 12 <= buf.length) {
    const length = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("ascii");
    const dataStart = off + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) break;

    if (type === "tEXt") {
      const data = buf.subarray(dataStart, dataEnd);
      const sep = data.indexOf(0);
      if (sep > 0) {
        const keyword = data.subarray(0, sep).toString("latin1");
        // PNG spec says latin1, but real-world tooling often writes UTF-8.
        // Try utf8 first, fall back to latin1 if it produced replacement chars.
        const utf8 = data.subarray(sep + 1).toString("utf8");
        out[keyword] = utf8.includes("�")
          ? data.subarray(sep + 1).toString("latin1")
          : utf8;
      }
    } else if (type === "iTXt") {
      const data = buf.subarray(dataStart, dataEnd);
      const sep1 = data.indexOf(0);
      if (sep1 > 0) {
        const keyword = data.subarray(0, sep1).toString("latin1");
        const compFlag = data[sep1 + 1] ?? 0;
        // Skip compression method byte
        let p = sep1 + 3;
        // Skip language tag (null-terminated)
        const sep2 = data.indexOf(0, p);
        if (sep2 < 0) {
          off = dataEnd + 4;
          continue;
        }
        p = sep2 + 1;
        // Skip translated keyword (null-terminated)
        const sep3 = data.indexOf(0, p);
        if (sep3 < 0) {
          off = dataEnd + 4;
          continue;
        }
        p = sep3 + 1;
        if (compFlag === 0) {
          out[keyword] = data.subarray(p).toString("utf8");
        }
        // Compressed iTXt isn't decoded — we don't expect it.
      }
    }

    if (type === "IEND") break;
    off = dataEnd + 4; // CRC
  }
  return out;
}

/**
 * Bundle of metadata pulled out of a location-map PNG in a single file
 * read. Returned by `readMapMetadata` — both the AOI polygon (if any)
 * and the AnonymizovanLokace flag come from the same tEXt chunks, so
 * we parse them together.
 */
export interface MapPngMetadata {
  /** GPS polygon in GeoJSON [lng, lat] order, or null if no AOI tag. */
  aoi: Array<[number, number]> | null;
  /** True when the map's tEXt carries an "AnonymizovanLokace=Ano"
   *  (or equivalent) flag — propagated to LocationMap.isAnonymized. */
  isAnonymized: boolean;
}

// Candidate keys are stored already-normalized (lowercase, ASCII-only,
// no spaces/punctuation) so the comparison is straight equality after
// the same normalization is applied to whatever the PNG actually carries.
// The OSM Map Generator writes the keyword as "Anonymizovaná lokace"
// (with diacritics + space); exiftool's JSON output sanitizes that to
// "AnonymizovanLokace", which is what we'd otherwise expect — but we
// must match against the real chunk keyword, not exiftool's view of it.
const ANON_TAG_KEYS = [
  "anonymizovanalokace",
  "anonymized",
  "anonymizedlocation",
  "isanonymized",
];
const ANON_TAG_VALUES = new Set(["ano", "yes", "true", "1"]);

/** Normalises a PNG tEXt/iTXt keyword for comparison: strips
 *  diacritics, lowercases, drops non-alphanumeric. So "Anonymizovaná
 *  lokace", "AnonymizovanLokace", and "anonymized location" all
 *  collapse to "anonymizovanalokace" / "anonymizedlocation" — the
 *  reader and the editor both go through this so they agree on what
 *  counts as the same key. */
export function normalizeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function readAnonymizedFlag(tags: Record<string, string>): boolean {
  const normalized = new Map<string, string>();
  for (const [k, v] of Object.entries(tags)) normalized.set(normalizeKey(k), v);
  for (const key of ANON_TAG_KEYS) {
    const v = normalized.get(key);
    if (v !== undefined && ANON_TAG_VALUES.has(v.trim().toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Extracts every metadata bit we care about from a location-map PNG in
 * a single file read: the AOI polygon (in GPS coords, if present) and
 * the anonymization flag.
 */
export async function readMapMetadata(
  sourcePath: string,
  bounds: [[number, number], [number, number]],
  width: number,
  height: number,
): Promise<MapPngMetadata> {
  const buf = await readFile(sourcePath);
  const tags = parsePngTextChunks(buf);
  return {
    aoi: parseAoiFromTags(tags, bounds, width, height),
    isAnonymized: readAnonymizedFlag(tags),
  };
}

/**
 * Extracts an AOI polygon from a PNG map's metadata and converts it from
 * pixel coordinates to GPS (in GeoJSON [lng, lat] order). Returns null if
 * the file has no AOI_POLYGON tag or it doesn't parse.
 *
 * Pixel→GPS uses the image's geographic bounds (computed from filename
 * GPS centre + zoom + pixel size). Pixel origin is top-left, so
 *   px = 0     → swLng (left = west)
 *   px = width → neLng
 *   py = 0     → neLat (top = north)
 *   py = height → swLat
 */
export async function readAoiPolygon(
  sourcePath: string,
  bounds: [[number, number], [number, number]],
  width: number,
  height: number,
): Promise<Array<[number, number]> | null> {
  const buf = await readFile(sourcePath);
  const tags = parsePngTextChunks(buf);
  return parseAoiFromTags(tags, bounds, width, height);
}

function parseAoiFromTags(
  tags: Record<string, string>,
  bounds: [[number, number], [number, number]],
  width: number,
  height: number,
): Array<[number, number]> | null {
  const raw = tags.AOI_POLYGON;
  if (!raw) return null;

  let parsed: { points?: unknown };
  try {
    parsed = JSON.parse(raw) as { points?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.points) || parsed.points.length < 3) return null;

  const [[swLat, swLng], [neLat, neLng]] = bounds;
  const out: Array<[number, number]> = [];
  for (const pt of parsed.points) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const px = Number(pt[0]);
    const py = Number(pt[1]);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const lng = swLng + (px / width) * (neLng - swLng);
    const lat = neLat - (py / height) * (neLat - swLat);
    out.push([lng, lat]);
  }
  if (out.length < 3) return null;
  // Close the linear ring as PostGIS expects.
  const first = out[0]!;
  const last = out.at(-1)!;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    out.push([first[0], first[1]]);
  }
  return out;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
