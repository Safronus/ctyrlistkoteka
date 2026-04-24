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

async function readExifSafe(
  path: string,
): Promise<{ dateTaken: Date | null; lat: number | null; lng: number | null }> {
  try {
    const exifr = (await import("exifr")).default;
    const exif = (await exifr.parse(path, {
      gps: true,
      pick: ["DateTimeOriginal", "CreateDate", "latitude", "longitude"],
    })) as
      | {
          DateTimeOriginal?: Date;
          CreateDate?: Date;
          latitude?: number;
          longitude?: number;
        }
      | undefined;
    if (!exif) return { dateTaken: null, lat: null, lng: null };
    return {
      dateTaken: exif.DateTimeOriginal ?? exif.CreateDate ?? null,
      lat: exif.latitude ?? null,
      lng: exif.longitude ?? null,
    };
  } catch {
    return { dateTaken: null, lat: null, lng: null };
  }
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
): Promise<{ maps: MapFileInfo[]; locationIds: Set<number> }> {
  const dir = join(ctx.dataDir, "maps");
  const files = await listFiles(dir);
  ctx.log.log({
    event: "maps.scan",
    level: "info",
    dir,
    count: files.length,
  });

  const maps: MapFileInfo[] = [];
  const locationIds = new Set<number>();

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
    locationIds.add(parsed.value.mapId);
  }

  if (ctx.opts.dryRun) {
    ctx.log.log({
      event: "maps.plan",
      level: "info",
      would_upsert_locations: locationIds.size,
      would_upsert_maps: maps.length,
    });
    return { maps, locationIds };
  }

  for (const m of maps) {
    // Best-effort decomposition — never fails. If the code doesn't match a
    // known shape, splitLocationCode returns the whole thing as cadastral.
    const parts = splitLocationCode(m.parsed.locationCode);
    const displayName =
      m.parsed.description || m.parsed.locationCode;

    // Bounds from GPS + zoom + image size (per docs/filename-convention.md §B)
    const bounds = await computeImageBounds(m);

    await ctx.prisma.location.upsert({
      where: { id: m.parsed.mapId },
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
        code: m.parsed.locationCode,
        codeTransliterated: toAsciiCode(m.parsed.locationCode),
        cadastralArea: parts.cadastralArea,
        locationType: parts.locationType,
        number: parts.number,
        subpart: parts.subpart,
        displayName,
      },
    });

    await ctx.prisma
      .$executeRaw`UPDATE locations SET center_point = ST_SetSRID(ST_MakePoint(${m.parsed.centerLng}, ${m.parsed.centerLat}), 4326) WHERE id = ${m.parsed.mapId}`;

    await ctx.prisma.locationMap.upsert({
      where: { id: m.parsed.mapId },
      create: {
        id: m.parsed.mapId,
        locationId: m.parsed.mapId,
        locationCode: m.parsed.locationCode,
        description: m.parsed.description,
        centerLat: m.parsed.centerLat,
        centerLng: m.parsed.centerLng,
        zoom: m.parsed.zoom,
        imagePath: m.path,
        imageBounds: bounds.bounds,
        imageWidth: bounds.width,
        imageHeight: bounds.height,
        hasPolygon: false, // TODO Fáze 8: EXIF AOI_POLYGON
        isAnonymized: false,
        originalFilename: m.filename,
      },
      update: {
        description: m.parsed.description,
        imageBounds: bounds.bounds,
        imageWidth: bounds.width,
        imageHeight: bounds.height,
      },
    });
  }

  ctx.log.log({
    event: "maps.done",
    level: "info",
    upserted: maps.length,
  });

  return { maps, locationIds };
}

async function computeImageBounds(m: MapFileInfo): Promise<{
  bounds: [[number, number], [number, number]];
  width: number;
  height: number;
}> {
  // Lazy-load sharp only when not in dry-run; here we're already past that.
  const sharp = (await import("sharp")).default as unknown as typeof import("sharp");
  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(m.path).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } catch {
    // Couldn't read — fall back to nominal 1280×960, bounds will be approximate.
    width = 1280;
    height = 960;
  }

  const { centerLat, centerLng, zoom } = m.parsed;
  const resolution =
    (156543.03 * Math.cos((centerLat * Math.PI) / 180)) / 2 ** zoom;
  const widthM = width * resolution;
  const heightM = height * resolution;
  const dLat = heightM / 111320;
  const dLng = widthM / (111320 * Math.cos((centerLat * Math.PI) / 180));
  return {
    bounds: [
      [centerLat - dLat / 2, centerLng - dLng / 2],
      [centerLat + dLat / 2, centerLng + dLng / 2],
    ],
    width,
    height,
  };
}

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
  knownLocationIds: Set<number>,
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
      (f) => !knownLocationIds.has(f.parsed.mapNumber),
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

  for (const f of all) {
    const sha1 = await sha1File(f.path);
    const image = await generateWebPVariants({
      sourcePath: f.path,
      generatedDir: ctx.generatedDir,
      forceRegen: ctx.opts.forceRegen,
      sha1,
    });
    const exif = await readExifSafe(f.path);
    const mapExists = knownLocationIds.has(f.parsed.mapNumber);

    await ctx.prisma.find.upsert({
      where: { id: f.parsed.findId },
      create: {
        id: f.parsed.findId,
        locationId: mapExists ? f.parsed.mapNumber : null,
        mapId: mapExists ? f.parsed.mapNumber : null,
        foundAt: exif.dateTaken ?? null,
        leafCount: 4,
        isAnonymized: f.parsed.isAnonymized,
      },
      update: {
        locationId: mapExists ? f.parsed.mapNumber : null,
        mapId: mapExists ? f.parsed.mapNumber : null,
        foundAt: exif.dateTaken ?? null,
        isAnonymized: f.parsed.isAnonymized,
      },
    });

    if (exif.lat !== null && exif.lng !== null) {
      await ctx.prisma
        .$executeRaw`UPDATE finds SET coordinates = ST_SetSRID(ST_MakePoint(${exif.lng}, ${exif.lat}), 4326) WHERE id = ${f.parsed.findId}`;
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

  ctx.log.log({ event: "finds.done", level: "info", upserted: all.length });
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

  // Notes
  for (const [idStr, note] of Object.entries(meta.poznamky)) {
    const id = Number(idStr);
    if (!Number.isInteger(id)) continue;
    await ctx.prisma.find.updateMany({
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
      await ctx.prisma.findStateAssignment.upsert({
        where: { findId_state: { findId: id, state } },
        create: { findId: id, state },
        update: {},
      });
    }
  }

  // Anonymization
  const anonIds = parseRanges(meta.anonymizace.ANONYMIZOVANE);
  if (anonIds.length > 0) {
    await ctx.prisma.find.updateMany({
      where: { id: { in: anonIds } },
      data: { isAnonymized: true },
    });
    for (const id of anonIds) {
      await ctx.prisma.findStateAssignment.upsert({
        where: { findId_state: { findId: id, state: FindState.ANONYMIZED } },
        create: { findId: id, state: FindState.ANONYMIZED },
        update: {},
      });
    }
  }

  ctx.log.log({ event: "meta.done", level: "info", ...plan });
}

// --------------------------------------------------------------------------
//  Prune phase — warn about DB records without a filesystem match
// --------------------------------------------------------------------------

async function phasePrune(
  ctx: Context,
  allFinds: readonly FindFileInfo[],
  knownLocationIds: ReadonlySet<number>,
) {
  const diskFindIds = new Set(allFinds.map((f) => f.parsed.findId));
  const dbFindIds = (await ctx.prisma.find.findMany({ select: { id: true } })).map(
    (r) => r.id,
  );
  const orphanFinds = dbFindIds.filter((id) => !diskFindIds.has(id));

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

    let knownLocationIds = new Set<number>();
    if (runMaps) {
      const r = await phaseMaps(ctx);
      knownLocationIds = r.locationIds;
    } else {
      // Reuse DB state when skipping maps
      const rows = await prisma.location.findMany({ select: { id: true } });
      knownLocationIds = new Set(rows.map((r) => r.id));
    }

    let allFinds: FindFileInfo[] = [];
    if (runFinds) {
      allFinds = await phaseFinds(ctx, knownLocationIds);
    }

    if (runMeta && meta) {
      await phaseMeta(ctx, meta);
    }

    if (runFinds) {
      await phasePrune(ctx, allFinds, knownLocationIds);
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
