/**
 * Filesystem → DB import.
 *
 *   pnpm sync                  # standardní import
 *   pnpm sync --dry-run        # jen parsování a plán, žádné DB zápisy
 *   pnpm sync --only=maps|finds|meta
 *   pnpm sync --find=16230     # jednotlivý nález pro debug
 *   pnpm sync --force-regen    # přegeneruj WebP i když existují
 *   pnpm sync --prune          # smaž DB záznamy, kterým chybí soubor
 *
 * Pořadí kroků viz docs/sync-workflow.md. Zdroje pravdy:
 *   - název souboru: IDs + kód lokality
 *   - EXIF: GPS + datum nálezu
 *   - LokaceStavyPoznamky.json: přiřazení find→lokace, stavy, poznámky, anonymizace
 */

import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
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
  const { generateMapWebP, computeMapBounds, readAoiPolygon, sha1File } =
    await import("../src/lib/images");

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
    const location = await ctx.prisma.location.upsert({
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

    mapToLocation.set(m.parsed.mapId, location.id);

    await ctx.prisma
      .$executeRaw`UPDATE locations SET center_point = ST_SetSRID(ST_MakePoint(${m.parsed.centerLng}, ${m.parsed.centerLat}), 4326) WHERE id = ${location.id}`;

    // Try to extract AOI polygon from the PNG's tEXt metadata. First map
    // for a given location wins — subsequent maps' polygons are noted on
    // the LocationMap row but don't overwrite the canonical Location.polygon.
    const aoi = await readAoiPolygon(
      m.path,
      bounds,
      mapImg.width,
      mapImg.height,
    );
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
        isAnonymized: false,
        originalFilename: m.filename,
      },
      update: {
        locationId: location.id,
        description: m.parsed.description,
        imagePath: mapImg.imageUrl,
        imageBounds: bounds,
        imageWidth: mapImg.width,
        imageHeight: mapImg.height,
        hasPolygon: aoi !== null,
      },
    });
  }

  ctx.log.log({
    event: "maps.done",
    level: "info",
    upserted_maps: maps.length,
    upserted_locations: new Set(mapToLocation.values()).size,
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

  let withGps = 0;
  let withoutGps = 0;
  let unexpectedNoGps = 0;
  let dateOnlyExif = 0;
  let noDateExif = 0;

  for (const f of all) {
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
  }

  ctx.log.log({
    event: "finds.done",
    level: "info",
    upserted: all.length,
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

  ctx.log.log({
    event: "prune.report",
    level: "info",
    orphan_finds: orphanFinds.length,
    orphan_locations: orphanLocations.length,
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
    });
    return;
  }

  if (orphanFinds.length > 0) {
    await ctx.prisma.find.deleteMany({ where: { id: { in: orphanFinds } } });
  }
  if (orphanLocations.length > 0) {
    await ctx.prisma.location.deleteMany({
      where: { id: { in: orphanLocations } },
    });
  }
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
