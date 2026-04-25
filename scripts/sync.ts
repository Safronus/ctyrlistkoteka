/**
 * Filesystem → DB import.
 *
 *   pnpm sync                  # standardní import
 *   pnpm sync --dry-run        # jen parsování a plán, žádné DB zápisy
 *   pnpm sync --only=maps|finds|meta
 *   pnpm sync --find=16230     # jednotlivý nález pro debug
 *   pnpm sync --force-regen    # přegeneruj WebP i když existují
 *   pnpm sync --prune          # smaž DB orphany (finds, locations,
 *                              #   location_maps) + WebP v generated/,
 *                              #   na které už nic v DB neukazuje
 *
 * Pořadí kroků viz docs/sync-workflow.md. Zdroje pravdy:
 *   - název souboru: IDs + kód lokality
 *   - EXIF: GPS + datum nálezu
 *   - LokaceStavyPoznamky.json: přiřazení find→lokace, stavy, poznámky, anonymizace
 */

import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import { extname, join } from "node:path";
import { FindState, ImageType, PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  parseFindFilename,
  parseMapFilename,
  type ParsedFindFilename,
  type ParsedMapFilename,
} from "../src/lib/parseFilename";
import { splitLocationCode, toAsciiCode } from "../src/lib/locationCode";
import { parseRanges } from "../src/lib/parseRanges";
import { JSON_STATE_MAP } from "../src/lib/stateMapping";

// --------------------------------------------------------------------------
//  CLI
// --------------------------------------------------------------------------

interface Options {
  dryRun: boolean;
  only: "maps" | "finds" | "meta" | null;
  findId: number | null;
  forceRegen: boolean;
  prune: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = {
    dryRun: false,
    only: null,
    findId: null,
    forceRegen: false,
    prune: false,
  };
  for (const a of argv) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--force-regen") opts.forceRegen = true;
    else if (a === "--prune") opts.prune = true;
    else if (a.startsWith("--only=")) {
      const v = a.slice("--only=".length);
      if (v !== "maps" && v !== "finds" && v !== "meta") {
        throw new Error(`--only must be maps|finds|meta, got "${v}"`);
      }
      opts.only = v;
    } else if (a.startsWith("--find=")) {
      const n = Number(a.slice("--find=".length));
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--find must be a positive integer`);
      }
      opts.findId = n;
    } else {
      throw new Error(`Unknown argument: "${a}"`);
    }
  }
  return opts;
}

// --------------------------------------------------------------------------
//  LokaceStavyPoznamky.json schema
// --------------------------------------------------------------------------

const RangeArray = z.array(z.string());

const MetaSchema = z.object({
  anonymizace: z
    .object({
      ANONYMIZOVANE: RangeArray.optional().default([]),
    })
    .optional()
    .default({ ANONYMIZOVANE: [] }),
  lokace: z.record(z.string(), RangeArray).optional().default({}),
  poznamky: z.record(z.string(), z.string()).optional().default({}),
  stavy: z.record(z.string(), RangeArray).optional().default({}),
});
type Meta = z.infer<typeof MetaSchema>;

// --------------------------------------------------------------------------
//  Logging
// --------------------------------------------------------------------------

interface LogContext {
  event: string;
  level: "info" | "warn" | "error";
  [key: string]: unknown;
}

class Logger {
  private mainStream: WriteStream;
  private failuresStream: WriteStream;
  private failureCount = 0;

  constructor(mainPath: string, failuresPath: string) {
    this.mainStream = createWriteStream(mainPath, { flags: "a" });
    this.failuresStream = createWriteStream(failuresPath, { flags: "a" });
  }

  log(ctx: LogContext) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...ctx });
    this.mainStream.write(line + "\n");
    const icon =
      ctx.level === "error" ? "✗" : ctx.level === "warn" ? "⚠" : "·";
    process.stdout.write(`${icon} ${ctx.event}`);
    const extras = { ...ctx } as Record<string, unknown>;
    delete extras.event;
    delete extras.level;
    const extraKeys = Object.keys(extras);
    if (extraKeys.length > 0) {
      process.stdout.write(
        " " +
          extraKeys
            .map((k) => `${k}=${JSON.stringify(extras[k])}`)
            .join(" "),
      );
    }
    process.stdout.write("\n");
  }

  failure(details: {
    file: string;
    reason: string;
    details?: unknown;
  }) {
    this.failureCount += 1;
    const line = JSON.stringify(details);
    this.failuresStream.write(line + "\n");
    this.log({ event: "parse_failure", level: "warn", ...details });
  }

  get failures() {
    return this.failureCount;
  }

  async close() {
    await Promise.all([
      new Promise<void>((r) => this.mainStream.end(r)),
      new Promise<void>((r) => this.failuresStream.end(r)),
    ]);
  }
}

// --------------------------------------------------------------------------
//  Helpers
// --------------------------------------------------------------------------

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "ENOENT"
    ) {
      return [];
    }
    throw err;
  }
}

async function readJsonMeta(path: string): Promise<Meta> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return MetaSchema.parse(parsed);
}

async function readExifSafe(path: string): Promise<{
  dateTaken: Date | null;
  /** True if the chosen `dateTaken` carries a non-zero clock component
   *  (i.e. HH:MM:SS not all zero). False when EXIF only stores a date. */
  dateTakenHasClock: boolean;
  lat: number | null;
  lng: number | null;
}> {
  try {
    const exifr = (await import("exifr")).default;
    // Default options give us EXIF + GPS with auto-unwrapping into top-level
    // `latitude` / `longitude`. `pick` was previously used here together
    // with `gps: true` and that combination filters output keys BEFORE the
    // GPS unwrap step — leaving us with empty results. Always read the full
    // default set; we filter to just the keys we need below.
    const exif = (await exifr.parse(path)) as
      | {
          DateTimeOriginal?: Date | string;
          DateTimeDigitized?: Date | string;
          CreateDate?: Date | string;
          ModifyDate?: Date | string;
          latitude?: number;
          longitude?: number;
          GPSLatitude?: number | number[];
          GPSLongitude?: number | number[];
          GPSLatitudeRef?: string;
          GPSLongitudeRef?: string;
        }
      | undefined;
    if (!exif) {
      return { dateTaken: null, dateTakenHasClock: false, lat: null, lng: null };
    }

    // Try every plausible EXIF date field, then prefer the first candidate
    // that actually carries a clock component — some pipelines (older
    // exiftool / heic-convert / WhatsApp etc.) strip the time portion of
    // DateTimeOriginal but leave it intact in CreateDate, or vice versa.
    const candidates = [
      exif.DateTimeOriginal,
      exif.DateTimeDigitized,
      exif.CreateDate,
      exif.ModifyDate,
    ]
      .map(toDate)
      .filter((d): d is Date => d !== null);
    const withClock = candidates.find(hasClockComponent);
    const dateTaken = withClock ?? candidates[0] ?? null;

    // Prefer the auto-unwrapped decimals; fall back to manually decoding
    // the raw degrees/minutes/seconds tuple some HEIC variants emit.
    const lat =
      typeof exif.latitude === "number"
        ? exif.latitude
        : toDecimalDegrees(exif.GPSLatitude, exif.GPSLatitudeRef);
    const lng =
      typeof exif.longitude === "number"
        ? exif.longitude
        : toDecimalDegrees(exif.GPSLongitude, exif.GPSLongitudeRef);

    return {
      dateTaken,
      dateTakenHasClock: dateTaken ? hasClockComponent(dateTaken) : false,
      lat: lat !== null && Number.isFinite(lat) ? lat : null,
      lng: lng !== null && Number.isFinite(lng) ? lng : null,
    };
  } catch {
    return { dateTaken: null, dateTakenHasClock: false, lat: null, lng: null };
  }
}

/**
 * Coerce an EXIF date field into a Date. exifr usually returns a Date
 * instance, but if the underlying value can't be parsed (unusual EXIF
 * variants, broken pipelines) it can fall back to the raw string.
 */
function toDate(v: Date | string | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  const m = /^(\d{4}):(\d{2}):(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/.exec(v);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  const dt = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh ?? 0),
    Number(mm ?? 0),
    Number(ss ?? 0),
  );
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function hasClockComponent(d: Date): boolean {
  return d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
}

/**
 * Converts EXIF GPS values (decimal number OR [deg, min, sec] tuple) plus a
 * direction reference ("N"/"S"/"E"/"W") into a signed decimal degree.
 */
function toDecimalDegrees(
  raw: number | number[] | undefined,
  ref: string | undefined,
): number | null {
  if (raw === undefined) return null;
  let dd: number;
  if (typeof raw === "number") {
    dd = raw;
  } else if (Array.isArray(raw) && raw.length >= 3) {
    dd = (raw[0] ?? 0) + (raw[1] ?? 0) / 60 + (raw[2] ?? 0) / 3600;
  } else {
    return null;
  }
  if (ref === "S" || ref === "W") dd = -dd;
  return Number.isFinite(dd) ? dd : null;
}

// --------------------------------------------------------------------------
//  Progress
// --------------------------------------------------------------------------

/**
 * Progress reporter for long-running per-file phases. Emits a structured
 * log line every ~5 s or every ~5 % of items, whichever comes first, and
 * always one final line when `total` is reached. We piggy-back on the
 * existing Logger so the output ends up in both stdout (visible to a
 * `| tee` user) and the JSON sync-*.log file.
 */
function makeProgressTicker(label: string, total: number, log: Logger) {
  const startedAt = Date.now();
  let lastLoggedAt = 0;
  let done = 0;
  const stepEvery = Math.max(1, Math.floor(total / 20));
  return {
    tick(): void {
      done += 1;
      const now = Date.now();
      const isLast = done === total;
      const dueByTime = now - lastLoggedAt >= 5000;
      const dueByCount = done % stepEvery === 0;
      if (!isLast && !dueByTime && !dueByCount) return;
      lastLoggedAt = now;
      const elapsedS = (now - startedAt) / 1000;
      const rate = elapsedS > 0 ? done / elapsedS : 0;
      const remaining = total - done;
      const etaS = rate > 0 ? Math.round(remaining / rate) : 0;
      log.log({
        event: `${label}.progress`,
        level: "info",
        done,
        total,
        pct: Number(((done / total) * 100).toFixed(1)),
        rate_per_s: Number(rate.toFixed(1)),
        eta_s: etaS,
      });
    },
  };
}

// --------------------------------------------------------------------------
//  Map phase — parse data/maps/ files
// --------------------------------------------------------------------------

interface MapFileInfo {
  filename: string;
  path: string;
  parsed: ParsedMapFilename;
}

async function phaseMaps(
  ctx: Context,
): Promise<{ maps: MapFileInfo[]; mapToLocation: Map<number, number> }> {
  const dir = join(ctx.dataDir, "maps");
  const files = await listFiles(dir);
  ctx.log.log({
    event: "maps.scan",
    level: "info",
    dir,
    count: files.length,
  });

  const maps: MapFileInfo[] = [];
  const uniqueCodes = new Set<string>();

  for (const filename of files) {
    const parsed = parseMapFilename(filename);
    if (!parsed.ok) {
      ctx.log.failure({
        file: `maps/${filename}`,
        reason: "parse_error",
        details: parsed.error,
      });
      continue;
    }
    maps.push({ filename, path: join(dir, filename), parsed: parsed.value });
    uniqueCodes.add(parsed.value.locationCode);
  }

  // mapId → locationId lookup, populated as we upsert Locations. Real data
  // has multiple maps per location (~7 dupes in 129 maps) so this is N:1
  // by location code, not 1:1 by mapId.
  const mapToLocation = new Map<number, number>();
  let anonymizedMapCount = 0;

  if (ctx.opts.dryRun) {
    ctx.log.log({
      event: "maps.plan",
      level: "info",
      would_upsert_locations: uniqueCodes.size,
      would_upsert_maps: maps.length,
      duplicate_codes: maps.length - uniqueCodes.size,
    });
    // In dry-run we still build the lookup so phaseFinds reports
    // unknown_map_refs honestly. mapId → mapId stand-in (good enough for
    // the count we report).
    for (const m of maps) mapToLocation.set(m.parsed.mapId, m.parsed.mapId);
    return { maps, mapToLocation };
  }

  // Lazy-load image helpers — keeps dry-run lightweight.
  const { generateMapWebP, computeMapBounds, readMapMetadata, sha1File } =
    await import("../src/lib/images");

  const progress = makeProgressTicker("maps.upsert", maps.length, ctx.log);

  for (const m of maps) {
    // Best-effort decomposition — never fails. If the code doesn't match a
    // known shape, splitLocationCode returns the whole thing as cadastral.
    const parts = splitLocationCode(m.parsed.locationCode);
    const displayName =
      m.parsed.description || m.parsed.locationCode;

    // Generate the WebP overlay variant for the browser. Returns the
    // /generated/maps/<sha>.webp URL we'll store in DB.
    const sha1 = await sha1File(m.path);
    const mapImg = await generateMapWebP({
      sourcePath: m.path,
      generatedDir: ctx.generatedDir,
      forceRegen: ctx.opts.forceRegen,
      sha1,
    });
    const bounds = computeMapBounds({
      centerLat: m.parsed.centerLat,
      centerLng: m.parsed.centerLng,
      zoom: m.parsed.zoom,
      width: mapImg.width,
      height: mapImg.height,
    });

    // Upsert by code — multiple maps may share a location. The first map
    // encountered for a code creates the Location row (with id=its mapId);
    // later maps with the same code reuse that row's id.
    // Wrapped in try/catch so a unique-violation (typically NFC vs NFD
    // mismatch between a renamed filename and the DB code) names the
    // exact file and parsed code instead of bubbling out anonymously.
    let location: { id: number };
    try {
      location = await ctx.prisma.location.upsert({
        where: { code: m.parsed.locationCode },
        create: {
          id: m.parsed.mapId,
          code: m.parsed.locationCode,
          codeTransliterated: toAsciiCode(m.parsed.locationCode),
          cadastralArea: parts.cadastralArea,
          locationType: parts.locationType,
          number: parts.number,
          subpart: parts.subpart,
          displayName,
        },
        update: {
          codeTransliterated: toAsciiCode(m.parsed.locationCode),
          cadastralArea: parts.cadastralArea,
          locationType: parts.locationType,
          number: parts.number,
          subpart: parts.subpart,
          displayName,
        },
        select: { id: true },
      });
    } catch (err) {
      const codeBytes = Buffer.from(m.parsed.locationCode, "utf8")
        .toString("hex");
      ctx.log.log({
        event: "maps.upsert_failed",
        level: "error",
        file: m.filename,
        parsed_code: m.parsed.locationCode,
        parsed_code_hex: codeBytes,
        parsed_map_id: m.parsed.mapId,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    mapToLocation.set(m.parsed.mapId, location.id);

    await ctx.prisma
      .$executeRaw`UPDATE locations SET center_point = ST_SetSRID(ST_MakePoint(${m.parsed.centerLng}, ${m.parsed.centerLat}), 4326) WHERE id = ${location.id}`;

    // Read PNG tEXt once for both AOI polygon (first map for a location
    // wins — subsequent maps don't overwrite the canonical
    // Location.polygon) and the AnonymizovanLokace flag.
    const meta = await readMapMetadata(
      m.path,
      bounds,
      mapImg.width,
      mapImg.height,
    );
    if (meta.isAnonymized) {
      anonymizedMapCount += 1;
      ctx.log.log({
        event: "maps.anonymized_metadata",
        level: "info",
        file: m.filename,
        location_id: location.id,
      });
    }
    const aoi = meta.aoi;
    if (aoi) {
      // Build POLYGON WKT in lng/lat order (PostGIS convention).
      const wkt =
        "POLYGON((" +
        aoi.map(([lng, lat]) => `${lng} ${lat}`).join(", ") +
        "))";
      // Only set if Location doesn't already have one (first wins).
      await ctx.prisma.$executeRaw`
        UPDATE locations
        SET polygon = ST_GeomFromText(${wkt}, 4326)
        WHERE id = ${location.id} AND polygon IS NULL
      `;
    }

    await ctx.prisma.locationMap.upsert({
      where: { id: m.parsed.mapId },
      create: {
        id: m.parsed.mapId,
        locationId: location.id,
        locationCode: m.parsed.locationCode,
        description: m.parsed.description,
        centerLat: m.parsed.centerLat,
        centerLng: m.parsed.centerLng,
        zoom: m.parsed.zoom,
        imagePath: mapImg.imageUrl,
        imageBounds: bounds,
        imageWidth: mapImg.width,
        imageHeight: mapImg.height,
        hasPolygon: aoi !== null,
        isAnonymized: meta.isAnonymized,
        originalFilename: m.filename,
      },
      update: {
        locationId: location.id,
        // Keep the denormalised code/filename in sync with whatever the
        // current PNG parses to — useful when a typo in the original
        // location code is fixed later by renaming the file.
        locationCode: m.parsed.locationCode,
        originalFilename: m.filename,
        description: m.parsed.description,
        imagePath: mapImg.imageUrl,
        imageBounds: bounds,
        imageWidth: mapImg.width,
        imageHeight: mapImg.height,
        hasPolygon: aoi !== null,
        isAnonymized: meta.isAnonymized,
      },
    });

    progress.tick();
  }

  ctx.log.log({
    event: "maps.done",
    level: "info",
    upserted_maps: maps.length,
    upserted_locations: new Set(mapToLocation.values()).size,
    anonymized_maps: anonymizedMapCount,
  });

  return { maps, mapToLocation };
}

// Bounds + image generation are now handled inline by generateMapWebP +
// computeMapBounds (src/lib/images.ts).

// --------------------------------------------------------------------------
//  Finds phase — parse data/finds/ and data/crops/
// --------------------------------------------------------------------------

interface FindFileInfo {
  filename: string;
  path: string;
  parsed: ParsedFindFilename;
  imageType: ImageType;
}

async function scanFindDir(
  dir: string,
  imageType: ImageType,
  ctx: Context,
  subdirLabel: string,
): Promise<FindFileInfo[]> {
  const files = await listFiles(dir);
  const out: FindFileInfo[] = [];
  for (const filename of files) {
    const parsed = parseFindFilename(filename);
    if (!parsed.ok) {
      ctx.log.failure({
        file: `${subdirLabel}/${filename}`,
        reason: "parse_error",
        details: parsed.error,
      });
      continue;
    }
    if (ctx.opts.findId !== null && parsed.value.findId !== ctx.opts.findId) {
      continue;
    }
    out.push({
      filename,
      path: join(dir, filename),
      parsed: parsed.value,
      imageType,
    });
  }
  return out;
}

async function phaseFinds(
  ctx: Context,
  mapToLocation: Map<number, number>,
): Promise<FindFileInfo[]> {
  const finds = await scanFindDir(
    join(ctx.dataDir, "finds"),
    ImageType.ORIGINAL,
    ctx,
    "finds",
  );
  const crops = await scanFindDir(
    join(ctx.dataDir, "crops"),
    ImageType.CROP,
    ctx,
    "crops",
  );
  const all = [...finds, ...crops];
  ctx.log.log({
    event: "finds.scan",
    level: "info",
    originals: finds.length,
    crops: crops.length,
  });

  if (ctx.opts.dryRun) {
    const unknownLocRefs = all.filter(
      (f) => !mapToLocation.has(f.parsed.mapNumber),
    ).length;
    const byState = countBy(all.map((f) => f.parsed.state));
    const anonCount = all.filter((f) => f.parsed.isAnonymized).length;
    ctx.log.log({
      event: "finds.plan",
      level: "info",
      would_upsert_finds: new Set(all.map((f) => f.parsed.findId)).size,
      would_upsert_images: all.length,
      filename_anon_flag: anonCount,
      by_state: byState,
      unknown_map_refs: unknownLocRefs,
    });
    return all;
  }

  const { generateWebPVariants, sha1File } = await import("../src/lib/images");

  // Fast-path skip lookup: which (findId, filename) pairs are already in
  // DB and when. Combined with the file's current mtime this lets us
  // skip every file the user hasn't touched since the last import — no
  // sha1 read, no EXIF read, no DB round-trip. For ~17k cached images
  // that turns a multi-minute sync into seconds, which is what makes
  // the 12-hour timer practical.
  //
  // Trade-offs:
  //   - We trust file mtime. rsync preserves source mtime by default, so
  //     a file that wasn't re-uploaded keeps its old timestamp and the
  //     skip kicks in. If the user `touch`es a file the mtime advances
  //     and we reprocess (wasteful but safe).
  //   - We don't verify that the WebP outputs still exist on disk. If
  //     someone manually deletes from generated/, the DB row will let
  //     us skip even though the variants are gone. Fix: re-run with
  //     --force-regen (which bypasses both this skip and the WebP
  //     cache).
  const ingestedAt = new Map<string, number>();
  for (const r of await ctx.prisma.findImage.findMany({
    select: { findId: true, originalFilename: true, createdAt: true },
  })) {
    ingestedAt.set(
      `${r.findId}:${r.originalFilename}`,
      r.createdAt.getTime(),
    );
  }

  let withGps = 0;
  let withoutGps = 0;
  let unexpectedNoGps = 0;
  let dateOnlyExif = 0;
  let noDateExif = 0;
  let skipped = 0;

  const progress = makeProgressTicker("finds.upsert", all.length, ctx.log);

  for (const f of all) {
    if (!ctx.opts.forceRegen) {
      const known = ingestedAt.get(`${f.parsed.findId}:${f.filename}`);
      if (known !== undefined) {
        const st = await stat(f.path);
        if (st.mtimeMs <= known) {
          skipped += 1;
          progress.tick();
          continue;
        }
      }
    }

    const sha1 = await sha1File(f.path);
    const image = await generateWebPVariants({
      sourcePath: f.path,
      generatedDir: ctx.generatedDir,
      forceRegen: ctx.opts.forceRegen,
      sha1,
    });
    const exif = await readExifSafe(f.path);
    const locationId = mapToLocation.get(f.parsed.mapNumber) ?? null;
    const mapId = locationId !== null ? f.parsed.mapNumber : null;

    if (!exif.dateTaken) noDateExif += 1;
    else if (!exif.dateTakenHasClock) dateOnlyExif += 1;

    await ctx.prisma.find.upsert({
      where: { id: f.parsed.findId },
      create: {
        id: f.parsed.findId,
        locationId,
        mapId,
        foundAt: exif.dateTaken ?? null,
        isAnonymized: f.parsed.isAnonymized,
      },
      update: {
        locationId,
        mapId,
        foundAt: exif.dateTaken ?? null,
        isAnonymized: f.parsed.isAnonymized,
      },
    });

    if (exif.lat !== null && exif.lng !== null) {
      await ctx.prisma
        .$executeRaw`UPDATE finds SET coordinates = ST_SetSRID(ST_MakePoint(${exif.lng}, ${exif.lat}), 4326) WHERE id = ${f.parsed.findId}`;
      withGps += 1;
    } else {
      withoutGps += 1;
      // Filename's STATE = BEZGPS legitimately has no GPS — don't flag.
      // Anything else is suspicious: we couldn't read EXIF coords from a
      // file the user expected to have them.
      if (f.parsed.state !== FindState.NO_GPS) {
        unexpectedNoGps += 1;
        ctx.log.failure({
          file: f.path,
          reason: "no_exif_gps",
          details: `find #${f.parsed.findId} has no readable GPS in EXIF (state ${f.parsed.state})`,
        });
      }
    }

    const existing = await ctx.prisma.findImage.findFirst({
      where: { findId: f.parsed.findId, originalSha1: sha1 },
    });
    if (!existing) {
      // Make the first image per find primary
      const hasAnyPrimary = await ctx.prisma.findImage.findFirst({
        where: { findId: f.parsed.findId, isPrimary: true },
      });
      await ctx.prisma.findImage.create({
        data: {
          findId: f.parsed.findId,
          imageType: f.imageType,
          originalFilename: f.filename,
          originalSha1: sha1,
          webPath: image.webPath,
          thumbPath: image.thumbPath,
          width: image.width,
          height: image.height,
          isPrimary: !hasAnyPrimary,
          sortOrder: 0,
        },
      });
    }

    progress.tick();
  }

  ctx.log.log({
    event: "finds.done",
    level: "info",
    upserted: all.length - skipped,
    skipped_unchanged: skipped,
    with_gps: withGps,
    without_gps: withoutGps,
    unexpected_no_gps: unexpectedNoGps,
    date_only_exif: dateOnlyExif,
    no_date_exif: noDateExif,
  });
  if (dateOnlyExif > 0) {
    ctx.log.log({
      event: "finds.exif_clock_missing",
      level: "warn",
      count: dateOnlyExif,
      note: "EXIF carried only a date, no time-of-day. Detail page will show 00:00:00 for these. Likely cause: the JPEG conversion pipeline stripped the clock — re-run prepare-upload.ts (with the exiftool fix) and rsync the files.",
    });
  }
  return all;
}

// --------------------------------------------------------------------------
//  Meta phase — JSON-driven notes, states, anonymization
// --------------------------------------------------------------------------

async function phaseMeta(ctx: Context, meta: Meta) {
  const plan = {
    notes: Object.keys(meta.poznamky).length,
    stateAssignments: Object.entries(meta.stavy).reduce(
      (acc, [key, specs]) => {
        if (!JSON_STATE_MAP[key]) return acc;
        return acc + parseRanges(specs).length;
      },
      0,
    ),
    anonymized: parseRanges(meta.anonymizace.ANONYMIZOVANE).length,
  };

  if (ctx.opts.dryRun) {
    ctx.log.log({ event: "meta.plan", level: "info", ...plan });
    return;
  }

  // JSON regularly references find IDs that don't (yet) exist in DB —
  // either because the user hasn't uploaded all photos, or because finds
  // were deleted. Filter every JSON-driven write through this set so we
  // don't blow up on FK violations.
  const existingFindIds = new Set(
    (await ctx.prisma.find.findMany({ select: { id: true } })).map((r) => r.id),
  );
  let skippedNotes = 0;
  let skippedStates = 0;
  let skippedAnon = 0;

  // Notes
  for (const [idStr, note] of Object.entries(meta.poznamky)) {
    const id = Number(idStr);
    if (!Number.isInteger(id)) continue;
    if (!existingFindIds.has(id)) {
      skippedNotes += 1;
      continue;
    }
    await ctx.prisma.find.update({
      where: { id },
      data: { notes: note },
    });
  }

  // States
  for (const [key, specs] of Object.entries(meta.stavy)) {
    const state = JSON_STATE_MAP[key];
    if (!state) {
      ctx.log.log({
        event: "meta.unknown_state_key",
        level: "warn",
        key,
      });
      continue;
    }
    const ids = parseRanges(specs);
    for (const id of ids) {
      if (!existingFindIds.has(id)) {
        skippedStates += 1;
        continue;
      }
      await ctx.prisma.findStateAssignment.upsert({
        where: { findId_state: { findId: id, state } },
        create: { findId: id, state },
        update: {},
      });
    }
  }

  // Anonymization
  const anonIds = parseRanges(meta.anonymizace.ANONYMIZOVANE);
  const anonIdsExisting = anonIds.filter((id) => existingFindIds.has(id));
  skippedAnon = anonIds.length - anonIdsExisting.length;
  if (anonIdsExisting.length > 0) {
    await ctx.prisma.find.updateMany({
      where: { id: { in: anonIdsExisting } },
      data: { isAnonymized: true },
    });
    for (const id of anonIdsExisting) {
      await ctx.prisma.findStateAssignment.upsert({
        where: { findId_state: { findId: id, state: FindState.ANONYMIZED } },
        create: { findId: id, state: FindState.ANONYMIZED },
        update: {},
      });
    }
  }

  if (skippedNotes + skippedStates + skippedAnon > 0) {
    ctx.log.log({
      event: "meta.skipped_missing_finds",
      level: "warn",
      notes: skippedNotes,
      states: skippedStates,
      anonymization: skippedAnon,
      hint: "JSON references find IDs that aren't on disk yet — usually OK during partial uploads",
    });
  }

  ctx.log.log({ event: "meta.done", level: "info", ...plan });
}

// --------------------------------------------------------------------------
//  Prune phase — warn about DB records without a filesystem match
// --------------------------------------------------------------------------

async function phasePrune(
  ctx: Context,
  allFinds: readonly FindFileInfo[],
  mapToLocation: ReadonlyMap<number, number>,
) {
  const diskFindIds = new Set(allFinds.map((f) => f.parsed.findId));
  const dbFindIds = (await ctx.prisma.find.findMany({ select: { id: true } })).map(
    (r) => r.id,
  );
  const orphanFinds = dbFindIds.filter((id) => !diskFindIds.has(id));

  // Locations on disk = the unique set of values in mapToLocation.
  const knownLocationIds = new Set(mapToLocation.values());
  const dbLocationIds = (
    await ctx.prisma.location.findMany({ select: { id: true } })
  ).map((r) => r.id);
  const orphanLocations = dbLocationIds.filter(
    (id) => !knownLocationIds.has(id),
  );

  // Maps on disk = the keys of mapToLocation. Existing rows whose mapId is
  // no longer on disk are orphans — happens when the user deletes/renames
  // a map PNG. Find.map relation is onDelete: SetNull, so wiping these
  // just nulls map_id on referencing finds.
  const knownMapIds = new Set(mapToLocation.keys());
  const dbMapIds = (
    await ctx.prisma.locationMap.findMany({ select: { id: true } })
  ).map((r) => r.id);
  const orphanMaps = dbMapIds.filter((id) => !knownMapIds.has(id));

  ctx.log.log({
    event: "prune.report",
    level: "info",
    orphan_finds: orphanFinds.length,
    orphan_locations: orphanLocations.length,
    orphan_maps: orphanMaps.length,
  });

  if (!ctx.opts.prune) {
    ctx.log.log({
      event: "prune.skipped",
      level: "info",
      note: "pass --prune to actually delete",
    });
    return;
  }

  if (ctx.opts.dryRun) {
    ctx.log.log({
      event: "prune.dryrun",
      level: "info",
      note: "no deletions performed (--dry-run)",
      would_delete_finds: orphanFinds.length,
      would_delete_locations: orphanLocations.length,
      would_delete_maps: orphanMaps.length,
    });
    // Still scan generated/ so the user sees what would be freed.
    await pruneGeneratedFiles(ctx);
    return;
  }

  // Order: maps first, then finds, then locations. Cascades:
  //   - LocationMap delete: nulls find.map_id (Find.map = onDelete: SetNull)
  //   - Find delete: cascades to FindImage rows
  //   - Location delete: cascades to remaining LocationMap rows for that
  //     location (they should already be gone if we deleted them above, so
  //     this is a no-op unless the orphan-location set diverged)
  if (orphanMaps.length > 0) {
    await ctx.prisma.locationMap.deleteMany({
      where: { id: { in: orphanMaps } },
    });
  }
  if (orphanFinds.length > 0) {
    await ctx.prisma.find.deleteMany({ where: { id: { in: orphanFinds } } });
  }
  if (orphanLocations.length > 0) {
    await ctx.prisma.location.deleteMany({
      where: { id: { in: orphanLocations } },
    });
  }

  // After DB is consistent with disk, drop generated/ files no DB row
  // points at anymore. Otherwise stats/gallery photos for deleted finds
  // would still be served (via the WebP that the user hasn't touched).
  await pruneGeneratedFiles(ctx);
}

/**
 * Scans `$GENERATED_DIR/{web,thumb,maps}` and removes any `<sha1>.webp`
 * file that no FindImage / LocationMap row references. Called from
 * phasePrune after DB orphans have been deleted, so the reference set
 * is whatever survived. In --dry-run mode it just reports.
 *
 * Files we don't recognise (different extension, non-sha1 basename) are
 * left alone — covers the case where a future variant gets dropped into
 * the same dir without us knowing about it.
 */
async function pruneGeneratedFiles(ctx: Context): Promise<void> {
  const refWeb = new Set<string>();
  const refThumb = new Set<string>();
  const refMaps = new Set<string>();

  const findImages = await ctx.prisma.findImage.findMany({
    select: { webPath: true, thumbPath: true },
  });
  for (const r of findImages) {
    const w = extractSha1FromGeneratedPath(r.webPath);
    const t = extractSha1FromGeneratedPath(r.thumbPath);
    if (w) refWeb.add(w);
    if (t) refThumb.add(t);
  }

  const maps = await ctx.prisma.locationMap.findMany({
    select: { imagePath: true },
  });
  for (const m of maps) {
    const s = extractSha1FromGeneratedPath(m.imagePath);
    if (s) refMaps.add(s);
  }

  const subdirs: Array<[string, ReadonlySet<string>]> = [
    ["web", refWeb],
    ["thumb", refThumb],
    ["maps", refMaps],
  ];

  let totalDeleted = 0;
  let totalKept = 0;
  let totalBytesFreed = 0;
  const perSubdir: Record<string, { deleted: number; kept: number }> = {};

  for (const [subdir, refSet] of subdirs) {
    const dir = join(ctx.generatedDir, subdir);
    const entries = await listFiles(dir);
    let deleted = 0;
    let kept = 0;
    for (const file of entries) {
      const m = /^([a-f0-9]{40})\.webp$/i.exec(file);
      if (!m) {
        kept += 1;
        continue;
      }
      if (refSet.has(m[1]!.toLowerCase())) {
        kept += 1;
        continue;
      }
      const full = join(dir, file);
      let size = 0;
      try {
        size = (await stat(full)).size;
      } catch {
        continue;
      }
      if (!ctx.opts.dryRun) {
        try {
          await unlink(full);
        } catch (err) {
          ctx.log.log({
            event: "prune.generated.unlink_failed",
            level: "warn",
            file: full,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
      }
      deleted += 1;
      totalBytesFreed += size;
    }
    perSubdir[subdir] = { deleted, kept };
    totalDeleted += deleted;
    totalKept += kept;
  }

  ctx.log.log({
    event: ctx.opts.dryRun
      ? "prune.generated.dryrun"
      : "prune.generated.done",
    level: "info",
    deleted_files: totalDeleted,
    kept_files: totalKept,
    bytes_freed: totalBytesFreed,
    by_subdir: perSubdir,
  });
}

/**
 * Pulls the SHA-1 out of a `/generated/{web,thumb,maps}/<sha>.webp`
 * URL. We accept both the full public URL form (what's stored in DB)
 * and a bare filename. Returns lowercase hex or null.
 */
function extractSha1FromGeneratedPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /([a-f0-9]{40})\.webp/i.exec(value);
  return m ? m[1]!.toLowerCase() : null;
}

// --------------------------------------------------------------------------
//  Entry
// --------------------------------------------------------------------------

interface Context {
  opts: Options;
  prisma: PrismaClient;
  log: Logger;
  dataDir: string;
  generatedDir: string;
}

function countBy<T extends string>(values: readonly T[]): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const dataDir = process.env.DATA_DIR ?? "./data";
  const generatedDir = process.env.GENERATED_DIR ?? "./public/generated";

  const logsDir = "./logs";
  await mkdir(logsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const log = new Logger(
    join(logsDir, `sync-${ts}.log`),
    join(logsDir, `sync-failures-${ts}.jsonl`),
  );

  const prisma = new PrismaClient();
  const ctx: Context = { opts, prisma, log, dataDir, generatedDir };

  log.log({
    event: "sync.start",
    level: "info",
    dry_run: opts.dryRun,
    only: opts.only,
    data_dir: dataDir,
    generated_dir: generatedDir,
  });

  try {
    // Load + validate JSON first so we fail fast on bad metadata.
    const metaPath = join(dataDir, "meta", "LokaceStavyPoznamky.json");
    let meta: Meta | null = null;
    try {
      meta = await readJsonMeta(metaPath);
      log.log({
        event: "meta.loaded",
        level: "info",
        locations: Object.keys(meta.lokace).length,
        notes: Object.keys(meta.poznamky).length,
        state_keys: Object.keys(meta.stavy).length,
        anonymized_specs: meta.anonymizace.ANONYMIZOVANE.length,
      });
    } catch (err: unknown) {
      log.log({
        event: "meta.missing_or_invalid",
        level: "warn",
        path: metaPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const runMaps = opts.only === null || opts.only === "maps";
    const runFinds = opts.only === null || opts.only === "finds";
    const runMeta = (opts.only === null || opts.only === "meta") && meta !== null;

    let mapToLocation = new Map<number, number>();
    if (runMaps) {
      const r = await phaseMaps(ctx);
      mapToLocation = r.mapToLocation;
    } else {
      // Reuse DB state when skipping maps — read existing location_maps.
      const rows = await prisma.locationMap.findMany({
        select: { id: true, locationId: true },
      });
      for (const r of rows) mapToLocation.set(r.id, r.locationId);
    }

    let allFinds: FindFileInfo[] = [];
    if (runFinds) {
      allFinds = await phaseFinds(ctx, mapToLocation);
    }

    if (runMeta && meta) {
      await phaseMeta(ctx, meta);
    }

    if (runFinds) {
      await phasePrune(ctx, allFinds, mapToLocation);
    }

    log.log({
      event: "sync.done",
      level: "info",
      parse_failures: log.failures,
    });
  } catch (err: unknown) {
    log.log({
      event: "sync.fatal",
      level: "error",
      error: err instanceof Error ? err.stack ?? err.message : String(err),
    });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await log.close();
  }
}

main();
