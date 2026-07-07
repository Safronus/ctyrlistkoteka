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
import { readExifSafe } from "../src/lib/admin/exif";
import {
  computeLocationDrift,
  planLocationRenumber,
} from "../src/lib/admin/locationIdReconcile";
import { splitLocationCode, toAsciiCode } from "../src/lib/locationCode";
import { parseRanges } from "../src/lib/parseRanges";
import { JSON_STATE_MAP } from "../src/lib/stateMapping";
import { findUrl, pingIndexNow } from "../src/lib/indexnow";
import { pingRevalidate } from "../src/lib/revalidatePing";
import type { WatermarkSpec } from "../src/lib/images";
import {
  DEFAULT_WATERMARK_OPTIONS,
  getWatermarkBuffer,
} from "../src/lib/watermark";

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
//  LokaceHierarchie.json schema
// --------------------------------------------------------------------------
// Standalone optional file, intentionally separate from
// LokaceStavyPoznamky.json (the user explicitly wants those concerns
// kept apart). Top-level shape: { parent_code: [ child, ... ] } where
// each child is EITHER a bare "child_code" string (default-hidden on
// /mapa) OR an object { "code": "child_code", "map": true } (overlays
// the parent polygon on /mapa by default). The string form is legacy;
// `map` defaults to false.
// Validation rules — enforced in phaseHierarchy:
//   1. Both parent and every child must exist in the locations table.
//   2. A child can have at most one parent.
//   3. Max depth 2: a parent declared in this file must not itself
//      appear as someone else's child.
//   4. No self-references (a code can't be its own parent).
// Violations are logged and skipped — they never fail the whole sync.

const HierarchyChildSchema = z.union([
  z.string(),
  z.object({ code: z.string(), map: z.boolean().optional() }),
]);
const HierarchySchema = z.record(z.string(), z.array(HierarchyChildSchema));
type Hierarchy = z.infer<typeof HierarchySchema>;
type HierarchyChild = z.infer<typeof HierarchyChildSchema>;

/** Code of a hierarchy child entry regardless of string/object form. */
function hierarchyChildCode(child: HierarchyChild): string {
  return typeof child === "string" ? child : child.code;
}
/** Whether a child opts into the /mapa default-overlay. */
function hierarchyChildMapDefault(child: HierarchyChild): boolean {
  return typeof child === "string" ? false : child.map === true;
}

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
    const icon = ctx.level === "error" ? "✗" : ctx.level === "warn" ? "⚠" : "·";
    process.stdout.write(`${icon} ${ctx.event}`);
    const extras = { ...ctx } as Record<string, unknown>;
    delete extras.event;
    delete extras.level;
    const extraKeys = Object.keys(extras);
    if (extraKeys.length > 0) {
      process.stdout.write(
        " " +
          extraKeys.map((k) => `${k}=${JSON.stringify(extras[k])}`).join(" "),
      );
    }
    process.stdout.write("\n");
  }

  failure(details: { file: string; reason: string; details?: unknown }) {
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

/**
 * Reads `data/meta/LokaceHierarchie.json` if it exists. Returns null when
 * the file is missing — hierarchy is opt-in and most installations won't
 * declare any. Parse errors propagate so the operator gets a clean
 * failure instead of silently dropping the relationships.
 */
async function readHierarchy(path: string): Promise<Hierarchy | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return HierarchySchema.parse(parsed);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
}

// EXIF reading + GPS unwrap moved into src/lib/admin/exif.ts so the
// admin upload routes can reuse the same helper. `readExifSafe` is
// imported below; sync.ts callers keep their existing call sites
// unchanged.

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
/** Bounded-concurrency parallel map. Pulls items off a shared cursor;
 *  each worker calls `fn` for one item, awaits it, then pulls the next.
 *  Items finish out-of-order — the caller must not rely on input order.
 *
 *  Returns when every item has completed (success or rejection). A
 *  single `fn` rejection propagates via `Promise.all` and aborts the
 *  remaining workers' pulls — same fail-fast semantics as the
 *  pre-existing sequential `for..of await` loop, so any error in any
 *  file stops the phase exactly as before.
 *
 *  No new dependency: this is the kernel of `p-limit` / `p-map` in
 *  ~15 lines without the ergonomic surface (priorities, abort signals)
 *  we don't need here. */
async function pMap<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      // Single statement read+increment — atomic under V8's event-loop
      // model (no preemption between the read and the postfix bump).
      const idx = cursor++;
      if (idx >= items.length) return;
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}

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
  // NEEXISTUJE- prefixed files are processed normally — the schema
  // explicitly supports the prefix on Location.code (see prisma
  // schema comment), and the admin's rename-as-zaniklá flow expects
  // sync to update DB to match the new filename. The natural upsert
  // by mapId will re-point the existing location_map at the new
  // (NEEXISTUJE-…) location; the old location becomes orphan and is
  // cleaned up later in phasePrune.
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
    const displayName = m.parsed.description || m.parsed.locationCode;

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

    // Locate (or create) the Location row this map belongs to. The
    // simple "upsert by code" approach can't handle the rename case:
    // when only the locationCode in a filename changes (e.g.
    // `ZLIN_NSTR.png` → `NEEXISTUJE-ZLIN_NSTR.png`, same MAP_ID), the
    // new code isn't in DB yet so upsert tries to CREATE with id=mapId
    // — but that PK is already held by the old row keyed by the old
    // code. Instead, do a 1- or 2-step lookup:
    //
    //   1. byCode: existing row already keyed under this code → just
    //      update its denormalised fields.
    //   2. byId: PK already taken by a row with a *different* code →
    //      this is a rename. Update that row's code in place, unless
    //      another map on disk still uses the old code (a "fork": some
    //      map files were renamed, others weren't), in which case we
    //      create a fresh Location with a new PK and let the old row
    //      stay attached to the un-renamed sibling map.
    //   3. neither: brand-new Location, plain create.
    //
    // The catch wrapper preserves the old NFC/NFD diagnostic — those
    // errors can still surface on the rename-rename path if codes
    // differ only by Unicode form.
    let location: { id: number };
    try {
      const byCode = await ctx.prisma.location.findUnique({
        where: { code: m.parsed.locationCode },
        select: { id: true },
      });

      const locationData = {
        codeTransliterated: toAsciiCode(m.parsed.locationCode),
        cadastralArea: parts.cadastralArea,
        locationType: parts.locationType,
        number: parts.number,
        subpart: parts.subpart,
        displayName,
      };

      if (byCode) {
        location = await ctx.prisma.location.update({
          where: { id: byCode.id },
          data: locationData,
          select: { id: true },
        });
      } else {
        const byId = await ctx.prisma.location.findUnique({
          where: { id: m.parsed.mapId },
          select: { id: true, code: true },
        });
        if (byId) {
          // PK collision under a different code → this is a rename
          // (file's locationCode changed, MAP_ID stayed the same).
          // If any other map on disk still claims the old code, we
          // can't move the row — split off a fresh Location instead.
          const stillUsed = maps.some(
            (other) =>
              other.parsed.mapId !== m.parsed.mapId &&
              other.parsed.locationCode === byId.code,
          );
          if (stillUsed) {
            const max = await ctx.prisma.location.aggregate({
              _max: { id: true },
            });
            const newId = (max._max.id ?? 0) + 1;
            location = await ctx.prisma.location.create({
              data: {
                id: newId,
                code: m.parsed.locationCode,
                ...locationData,
              },
              select: { id: true },
            });
            ctx.log.log({
              event: "maps.location_forked",
              level: "info",
              file: m.filename,
              old_code: byId.code,
              new_code: m.parsed.locationCode,
              kept_id: byId.id,
              fresh_id: newId,
              note: "old code still in use by another map — created new Location row",
            });
          } else {
            location = await ctx.prisma.location.update({
              where: { id: m.parsed.mapId },
              data: { code: m.parsed.locationCode, ...locationData },
              select: { id: true },
            });
            ctx.log.log({
              event: "maps.location_renamed",
              level: "info",
              file: m.filename,
              old_code: byId.code,
              new_code: m.parsed.locationCode,
              location_id: byId.id,
            });
          }
        } else {
          location = await ctx.prisma.location.create({
            data: {
              id: m.parsed.mapId,
              code: m.parsed.locationCode,
              ...locationData,
            },
            select: { id: true },
          });
        }
      }
    } catch (err) {
      const codeBytes = Buffer.from(m.parsed.locationCode, "utf8").toString(
        "hex",
      );
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

    // Read PNG tEXt once for both AOI polygon and the AnonymizovanLokace
    // flag. When several maps belong to the same location, the AOI from
    // whichever map is processed last wins — that mirrors the user's
    // expectation when a map gets replaced via rsync (the new EXIF
    // AOI_POLYGON should redraw the polygon and recompute area/density).
    // The previous "first wins, never overwrite" rule meant a re-synced
    // map silently kept the stale polygon in DB even though every other
    // page rendered the new PNG.
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
      await ctx.prisma.$executeRaw`
        UPDATE locations
        SET polygon = ST_GeomFromText(${wkt}, 4326)
        WHERE id = ${location.id}
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
  /** When set (only on the CROP pass), the function falls back to the
   *  short-form `<id>.jpg` filename — the same relaxation the admin
   *  upload action accepts (see src/app/admin/files/crops/upload-action.ts).
   *  Missing metadata (mapNumber, locationCode, state, isAnonymized)
   *  is recovered from the matching ORIGINAL's parsed filename so the
   *  downstream upsert keeps treating the find row identically. */
  originalsByFindId?: Map<number, ParsedFindFilename>,
): Promise<FindFileInfo[]> {
  const files = await listFiles(dir);
  const out: FindFileInfo[] = [];
  for (const filename of files) {
    let parsedValue: ParsedFindFilename | null = null;
    const parsed = parseFindFilename(filename);
    if (parsed.ok) {
      parsedValue = parsed.value;
    } else if (originalsByFindId && imageType === ImageType.CROP) {
      // Short-form crop fallback: `<id>.jpg` / `<id>.jpeg`. Mirror the
      // upload-action regex exactly so the two parsers stay in lock
      // step. Without this every crop uploaded in the convenience
      // form silently disappears from the DB while the JPEG sits
      // intact on disk — exactly the symptom that motivated this
      // relaxation. Look up the matching original to fill the rest
      // of the parsed metadata; an orphan crop (no original) is
      // logged so it surfaces during review.
      const short = /^(\d+)\.(jpe?g)$/i.exec(filename.normalize("NFC"));
      if (short) {
        const findId = Number(short[1]);
        const original = originalsByFindId.get(findId);
        if (original) {
          parsedValue = {
            ...original,
            extension: short[2]!.toLowerCase(),
          };
        } else {
          ctx.log.failure({
            file: `${subdirLabel}/${filename}`,
            reason: "orphan_crop",
            details: `Short-form crop ${filename} has no matching original in data/finds/ (find #${findId}).`,
          });
          continue;
        }
      }
    }
    if (!parsedValue) {
      ctx.log.failure({
        file: `${subdirLabel}/${filename}`,
        reason: "parse_error",
        details: parsed.ok ? "(unreachable)" : parsed.error,
      });
      continue;
    }
    if (ctx.opts.findId !== null && parsedValue.findId !== ctx.opts.findId) {
      continue;
    }
    out.push({
      filename,
      path: join(dir, filename),
      parsed: parsedValue,
      imageType,
    });
  }
  return out;
}

/**
 * Re-link finds to their location/map from the filename + the maps present
 * this run, independently of whether their photo changed. A find first
 * ingested while its location map was missing keeps `location_id = null`;
 * when the map is uploaded later the photo bytes don't change, so the
 * per-file upsert in phaseFinds skips it and it never gets re-linked. This
 * cheap pass closes that gap.
 *
 * Conservative on purpose: it only FILLS (null → id) or FIXES (wrong id →
 * right id) links for finds whose map IS on disk this run. It never nulls a
 * find whose map is absent, so a mapless / partial sync can't wipe existing
 * locations. Returns how many finds it re-linked (or, in --dry-run, would).
 */
async function reconcileFindLinks(
  ctx: Context,
  all: FindFileInfo[],
  mapToLocation: ReadonlyMap<number, number>,
): Promise<number> {
  // Desired link per find — POSITIVE only (map present → location known).
  const desired = new Map<number, { locationId: number; mapId: number }>();
  for (const f of all) {
    if (desired.has(f.parsed.findId)) continue;
    const locationId = mapToLocation.get(f.parsed.mapNumber);
    if (locationId === undefined) continue; // map not on disk → never wipe
    desired.set(f.parsed.findId, { locationId, mapId: f.parsed.mapNumber });
  }
  if (desired.size === 0) return 0;

  const current = await ctx.prisma.find.findMany({
    select: { id: true, locationId: true, mapId: true },
  });
  const mismatched = current.filter((c) => {
    const want = desired.get(c.id);
    return (
      want !== undefined &&
      (c.locationId !== want.locationId || c.mapId !== want.mapId)
    );
  });
  if (mismatched.length === 0 || ctx.opts.dryRun) return mismatched.length;

  for (const c of mismatched) {
    const want = desired.get(c.id)!;
    await ctx.prisma.find.update({
      where: { id: c.id },
      data: { locationId: want.locationId, mapId: want.mapId },
    });
  }
  return mismatched.length;
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
  // Build the originals lookup so the crops pass can resolve
  // short-form `<id>.jpg` filenames against full-form metadata.
  const originalsByFindId = new Map<number, ParsedFindFilename>();
  for (const f of finds) originalsByFindId.set(f.parsed.findId, f.parsed);
  const crops = await scanFindDir(
    join(ctx.dataDir, "crops"),
    ImageType.CROP,
    ctx,
    "crops",
    originalsByFindId,
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
    // No would_relink here: in dry-run mapToLocation is a mapId→mapId
    // stand-in (see phaseMaps), so a re-link count would be meaningless.
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

  // Cap each sharp pipeline to a single libvips thread. The default
  // (~num_cpus) would let four concurrent sharp calls allocate up to
  // 24 worker threads on the 6-vCPU VPS, fighting heic-convert + the
  // event loop for cycles. With concurrency=1 a 4-worker outer pool
  // (2 originals + 2 crops) spends at most 4 libvips threads — sized
  // for the box without context-switch overhead. Idempotent: calling
  // it on an already-loaded sharp is a no-op past the first call.
  const sharpLib = (await import("sharp")).default;
  sharpLib.concurrency(1);

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
  // Cache key MUST include `imageType`. Crops and originals can share
  // the same filename (the project convention even encourages it for
  // matching pairs), and FindImage allows one ORIGINAL + one CROP row
  // per find. Without imageType in the key, Map.set collapses the two
  // rows into one entry — and worse, when one of those rows is missing
  // from the DB, the lookup hits the SURVIVING row's createdAt and
  // skips the file whose row needs (re-)creating. That's the
  // mechanism that left orphan files visible in admin/files/crops
  // with no matching FindImage(CROP) row, which fed back as false
  // positives to /admin/checks → "Originály bez výřezu".
  for (const r of await ctx.prisma.findImage.findMany({
    select: {
      findId: true,
      imageType: true,
      originalFilename: true,
      createdAt: true,
    },
  })) {
    ingestedAt.set(
      `${r.findId}:${r.imageType}:${r.originalFilename}`,
      r.createdAt.getTime(),
    );
  }

  // Pre-fetch existing FindImage rows keyed by (findId, imageType).
  // Replaces the per-file `findFirst` lookup inside the worker with
  // a Map.get — saves one DB round-trip per file (≈ 17k saved trips
  // on a full sync) and is the only way the parallel pipeline can
  // resolve "does this row already exist?" without racing with its
  // sibling worker on the same findId. Includes every field the
  // worker compares against (sha1, filename, paths, width, height)
  // so the diff happens in JS without a follow-up read.
  const existingImagesByKey = new Map<
    string,
    {
      id: number;
      originalSha1: string | null;
      originalFilename: string;
      webPath: string;
      thumbPath: string;
      width: number;
      height: number;
    }
  >();
  for (const r of await ctx.prisma.findImage.findMany({
    select: {
      id: true,
      findId: true,
      imageType: true,
      originalSha1: true,
      originalFilename: true,
      webPath: true,
      thumbPath: true,
      width: true,
      height: true,
    },
  })) {
    existingImagesByKey.set(`${r.findId}:${r.imageType}`, {
      id: r.id,
      originalSha1: r.originalSha1,
      originalFilename: r.originalFilename,
      webPath: r.webPath,
      thumbPath: r.thumbPath,
      width: r.width,
      height: r.height,
    });
  }

  // Counters mutated from the parallel workers below. Plain `+= 1` on
  // a primitive is safe in V8: the read-and-increment is a single
  // bytecode op with no `await` straddling it, so the event loop
  // cannot interleave another worker's increment in the middle. (If
  // we ever swap a counter for a more complex shared object the same
  // guarantee will no longer hold and these will need a real atomic.)
  let withGps = 0;
  let withoutGps = 0;
  let unexpectedNoGps = 0;
  let dateOnlyExif = 0;
  let noDateExif = 0;
  let skipped = 0;

  const progress = makeProgressTicker("finds.upsert", all.length, ctx.log);

  /** Process a single ORIGINAL or CROP file. Pure async function with
   *  no shared mutable state besides the counters above and the
   *  progress ticker — both interleave-safe at await boundaries.
   *  Called concurrently from `pMap` once per stream (originals,
   *  crops). Behaviour matches the prior sequential loop byte-for-
   *  byte, with two consequence-free refactors:
   *    1. `existingImagesByKey` Map lookup replaces a per-file
   *       `findImage.findFirst({findId, imageType})` round-trip.
   *    2. The "is this the first image of any kind for this find?"
   *       check that decided `isPrimary` is replaced by a
   *       deterministic rule based on `imageType` + the pre-built
   *       `originalsByFindId` set. See the comment on `isPrimary`
   *       below for why this matches the sequential outcome
   *       exactly. */
  async function processOne(f: FindFileInfo): Promise<void> {
    if (!ctx.opts.forceRegen) {
      const known = ingestedAt.get(
        `${f.parsed.findId}:${f.imageType}:${f.filename}`,
      );
      if (known !== undefined) {
        const st = await stat(f.path);
        if (st.mtimeMs <= known) {
          skipped += 1;
          progress.tick();
          return;
        }
      }
    }

    const sha1 = await sha1File(f.path);
    const image = await generateWebPVariants({
      sourcePath: f.path,
      generatedDir: ctx.generatedDir,
      forceRegen: ctx.opts.forceRegen,
      sha1,
      // Bake the watermark into newly-encoded variants. The cached
      // fast-path inside generateWebPVariants ignores `watermark` —
      // re-watermarking an existing WebP requires --force-regen.
      watermark: ctx.watermark,
    });
    const exif = await readExifSafe(f.path);
    const locationId = mapToLocation.get(f.parsed.mapNumber) ?? null;
    const mapId = locationId !== null ? f.parsed.mapNumber : null;

    if (!exif.dateTaken) noDateExif += 1;
    else if (!exif.dateTakenHasClock) dateOnlyExif += 1;

    // ORIGINAL is the canonical source of `foundAt`. CROP files often
    // have EXIF DateTimeOriginal stripped by the cropping pipeline.
    // In the prior sequential run the loop processed ORIGINAL before
    // CROP for the same findId — so an unconditional `foundAt =
    // exif.dateTaken ?? null` on the CROP iteration would clobber
    // the good date the ORIGINAL iteration wrote moments earlier.
    // The parallel version preserves this exact convergence:
    //   - update only sets foundAt when isOriginal → CROP never
    //     overwrites a date written by ORIGINAL, regardless of
    //     execution order;
    //   - create always sets foundAt → the rare CROP-without-
    //     ORIGINAL case still ends up with whatever date the CROP
    //     had (matches the prior fallback behaviour).
    // Both upserts compile to one INSERT ... ON CONFLICT DO UPDATE,
    // which Postgres serializes via the primary-key row lock, so
    // even simultaneous concurrent execution converges to the same
    // result the sequential loop produced.
    const isOriginal = f.imageType === ImageType.ORIGINAL;
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
        isAnonymized: f.parsed.isAnonymized,
        ...(isOriginal ? { foundAt: exif.dateTaken ?? null } : {}),
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

    // Upsert keyed by (findId, imageType): one ORIGINAL + one CROP per
    // find is the project convention (CLAUDE.md filename convention).
    // The previous lookup-by-sha1 created a new row every time the
    // source's content changed (re-encoded JPEG, different camera
    // export, watermark experiment), instead of updating the existing
    // row's sha1/paths. That left ~139 zombie rows in production for
    // finds 15903–16044 — visible only as duplicate find_images entries
    // pointing to orphan WebP files.
    const existing = existingImagesByKey.get(
      `${f.parsed.findId}:${f.imageType}`,
    );
    if (existing) {
      // Only write when something actually changed — minimises DB churn
      // on the common "same file, same content" sync.
      const changed =
        existing.originalSha1 !== sha1 ||
        existing.originalFilename !== f.filename ||
        existing.webPath !== image.webPath ||
        existing.thumbPath !== image.thumbPath ||
        existing.width !== image.width ||
        existing.height !== image.height;
      if (changed) {
        await ctx.prisma.findImage.update({
          where: { id: existing.id },
          data: {
            originalFilename: f.filename,
            originalSha1: sha1,
            webPath: image.webPath,
            thumbPath: image.thumbPath,
            width: image.width,
            height: image.height,
          },
        });
      }
    } else {
      // Deterministic isPrimary — the sequential loop iterated
      // originals first then crops, so for any find that had both an
      // ORIGINAL and a CROP the ORIGINAL was inserted first (no
      // existing primary → isPrimary=true) and the CROP second (saw
      // ORIGINAL's primary → isPrimary=false). A CROP without a
      // matching ORIGINAL was processed alone (no existing primary →
      // isPrimary=true). With ORIGINAL + CROP streams now running
      // concurrently, the order-dependent rule races: both workers
      // could find no primary and create two `isPrimary=true` rows,
      // exactly the corner case the new
      // `multi-primary-find-images` check on /admin/checks watches
      // for. Rewriting the rule against the static `originalsByFindId`
      // set (built before the loop) yields the same outcomes
      // deterministically, independent of execution order.
      const isPrimary =
        f.imageType === ImageType.ORIGINAL ||
        (f.imageType === ImageType.CROP &&
          !originalsByFindId.has(f.parsed.findId));
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
          isPrimary,
          sortOrder: 0,
        },
      });
    }

    progress.tick();
  }

  // Process each find as a unit — its ORIGINAL first (the foundAt source),
  // then its CROP — and take finds in ascending id order. /sbirka now shows
  // the CROP as the thumbnail, so a crop that landed before its original
  // during a sync made the live grid look half-broken; grouping guarantees a
  // find's original is always in place before its crop, and finds fill in
  // smoothly in order. Concurrency 4 keeps the same "4 files in flight"
  // throughput as the old two-stream Promise.all — sized for the 6-vCPU VPS
  // with `sharp.concurrency(1)` set above (≤ 4 sharp pipelines × 1 libvips
  // thread = 4 threads, leaving 2 vCPUs for Postgres + heic-convert + the
  // event loop). Each worker runs one file at a time (original then crop),
  // so it's still ≤ 4 concurrent sharp pipelines.
  const byFindId = new Map<
    number,
    { original?: FindFileInfo; crop?: FindFileInfo }
  >();
  for (const f of finds) {
    const g = byFindId.get(f.parsed.findId) ?? {};
    g.original = f;
    byFindId.set(f.parsed.findId, g);
  }
  for (const c of crops) {
    const g = byFindId.get(c.parsed.findId) ?? {};
    g.crop = c;
    byFindId.set(c.parsed.findId, g);
  }
  const findGroups = [...byFindId.entries()].sort((a, b) => a[0] - b[0]);
  await pMap(findGroups, 4, async ([, g]) => {
    if (g.original) await processOne(g.original);
    if (g.crop) await processOne(g.crop);
  });

  // Re-link finds whose map appeared after their photo was ingested — those
  // get `skipped_unchanged` above and would otherwise keep a stale/null
  // location. Runs every sync (self-healing); usually a no-op.
  const relinked = await reconcileFindLinks(ctx, all, mapToLocation);

  ctx.log.log({
    event: "finds.done",
    level: "info",
    upserted: all.length - skipped,
    skipped_unchanged: skipped,
    relinked,
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
    stateAssignments: Object.entries(meta.stavy).reduce((acc, [key, specs]) => {
      if (!JSON_STATE_MAP[key]) return acc;
      return acc + parseRanges(specs).length;
    }, 0),
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

  // Anonymization — the JSON list UNION every find sitting on a location
  // that has any anonymised map. The admin map toggle mirrors this into
  // the JSON (cascadeMapAnonToJson), but the sync enforces it here too so
  // a missed or hand-edited JSON can never leave a find on an anonymised
  // location publicly visible. phaseMaps has already written
  // LocationMap.isAnonymized by this point.
  const anonLocFinds = await ctx.prisma.find.findMany({
    where: { location: { maps: { some: { isAnonymized: true } } } },
    select: { id: true },
  });
  const anonIds = [
    ...new Set([
      ...parseRanges(meta.anonymizace.ANONYMIZOVANE),
      ...anonLocFinds.map((f) => f.id),
    ]),
  ];
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

  // ----------------------------------------------------------------
  // Convergence pass — delete state assignments and clear notes that
  // JSON no longer mentions. Without this, the admin "Unmark donated"
  // (and any manual JSON delete) leaves zombie rows in DB: filename +
  // JSON say NORMAL but findStateAssignment(id, DONATED) still exists,
  // Find.notes still has the old text. The upserts above only ever
  // grow the DB.
  //
  // Scope of deletion is bounded to states JSON can actually express
  // (JSON_STATE_MAP values + ANONYMIZED). NORMAL is implicit — never
  // a row in findStateAssignment — so it's not in the managed set.
  // ----------------------------------------------------------------
  const MANAGED_STATES: ReadonlySet<FindState> = new Set([
    ...Object.values(JSON_STATE_MAP),
    FindState.ANONYMIZED,
  ]);

  // Retired states — no longer assigned (dropped from JSON_STATE_MAP), so
  // any existing assignment is a leftover to be swept away. They're never
  // "desired", so listing them here makes the convergence pass below delete
  // every occurrence on the next sync.
  const DEPRECATED_STATES: ReadonlySet<FindState> = new Set([
    FindState.LOCATION_MISSING,
    FindState.LOCATION_GONE,
    FindState.NOT_PICKED,
  ]);

  const desiredStates = new Map<number, Set<FindState>>();
  const addDesired = (id: number, state: FindState) => {
    let s = desiredStates.get(id);
    if (!s) {
      s = new Set();
      desiredStates.set(id, s);
    }
    s.add(state);
  };
  for (const [key, specs] of Object.entries(meta.stavy)) {
    const state = JSON_STATE_MAP[key];
    if (!state) continue;
    for (const id of parseRanges(specs)) {
      if (existingFindIds.has(id)) addDesired(id, state);
    }
  }
  for (const id of anonIdsExisting) {
    addDesired(id, FindState.ANONYMIZED);
  }

  const allAssignments = await ctx.prisma.findStateAssignment.findMany({
    select: { findId: true, state: true },
  });
  const stateRowsToDelete = allAssignments.filter(
    (r) =>
      (MANAGED_STATES.has(r.state) || DEPRECATED_STATES.has(r.state)) &&
      !desiredStates.get(r.findId)?.has(r.state),
  );
  let deletedStates = 0;
  if (stateRowsToDelete.length > 0) {
    await Promise.all(
      stateRowsToDelete.map((r) =>
        ctx.prisma.findStateAssignment.delete({
          where: { findId_state: { findId: r.findId, state: r.state } },
        }),
      ),
    );
    deletedStates = stateRowsToDelete.length;
  }

  const desiredNoteIds = new Set<number>();
  for (const idStr of Object.keys(meta.poznamky)) {
    const id = Number(idStr);
    if (Number.isInteger(id) && existingFindIds.has(id)) {
      desiredNoteIds.add(id);
    }
  }
  const allNoted = await ctx.prisma.find.findMany({
    where: { notes: { not: null } },
    select: { id: true },
  });
  const noteIdsToClear = allNoted
    .filter((r) => !desiredNoteIds.has(r.id))
    .map((r) => r.id);
  let clearedNotes = 0;
  if (noteIdsToClear.length > 0) {
    const res = await ctx.prisma.find.updateMany({
      where: { id: { in: noteIdsToClear } },
      data: { notes: null },
    });
    clearedNotes = res.count;
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

  ctx.log.log({
    event: "meta.done",
    level: "info",
    ...plan,
    deleted_state_rows: deletedStates,
    cleared_notes: clearedNotes,
  });
}

// --------------------------------------------------------------------------
//  Hierarchy phase — apply LokaceHierarchie.json into Location.parent_id
// --------------------------------------------------------------------------

/**
 * Walks `data/meta/LokaceHierarchie.json` (when present) and writes
 * `Location.parent_id` accordingly. Idempotent: running it again with
 * the same JSON is a no-op, and removing an entry from the file unsets
 * the previous link on the next run.
 *
 * The skip strategy is intentionally lenient — every individual rule
 * violation logs and skips that one relationship, never aborting. The
 * sync script as a whole is meant to converge the DB toward whatever
 * the on-disk metadata says, not to gatekeep edits.
 */
async function phaseHierarchy(
  ctx: Context,
  hierarchy: Hierarchy | null,
): Promise<void> {
  if (!hierarchy) {
    ctx.log.log({ event: "hierarchy.skipped_missing_file", level: "info" });
    return;
  }

  // Build a code → id index for the locations currently in the DB.
  // We need these resolutions both for validation (does the parent /
  // child code exist?) and for the WHERE clauses below.
  const rows = await ctx.prisma.location.findMany({
    select: { id: true, code: true },
  });
  const idByCode = new Map<string, number>();
  for (const r of rows) idByCode.set(r.code, r.id);

  // First pass: validate each (parent, children[]) entry. Anything that
  // fails goes to the failures log and is dropped before we touch the
  // database. We collect the *resolved* parent_id → child_id[] map so
  // the second pass is pure SQL.
  const resolved = new Map<number, number[]>(); // parent_id → [child_id, ...]
  const declaredParents = new Set<number>(); // for cycle / depth check
  const claimedChildren = new Set<number>(); // 1 child → 1 parent
  const mapDefaultChildIds = new Set<number>(); // children with `map: true`

  for (const [parentCode, children] of Object.entries(hierarchy)) {
    const parentId = idByCode.get(parentCode);
    if (parentId === undefined) {
      ctx.log.failure({
        file: "meta/LokaceHierarchie.json",
        reason: "hierarchy_parent_missing",
        details: parentCode,
      });
      continue;
    }
    declaredParents.add(parentId);

    const validChildIds: number[] = [];
    for (const childEntry of children) {
      const childCode = hierarchyChildCode(childEntry);
      if (childCode === parentCode) {
        ctx.log.failure({
          file: "meta/LokaceHierarchie.json",
          reason: "hierarchy_self_reference",
          details: parentCode,
        });
        continue;
      }
      const childId = idByCode.get(childCode);
      if (childId === undefined) {
        ctx.log.failure({
          file: "meta/LokaceHierarchie.json",
          reason: "hierarchy_child_missing",
          details: `${parentCode} → ${childCode}`,
        });
        continue;
      }
      if (claimedChildren.has(childId)) {
        ctx.log.failure({
          file: "meta/LokaceHierarchie.json",
          reason: "hierarchy_duplicate_child",
          details: `${childCode} declared under more than one parent`,
        });
        continue;
      }
      claimedChildren.add(childId);
      validChildIds.push(childId);
      if (hierarchyChildMapDefault(childEntry)) {
        mapDefaultChildIds.add(childId);
      }
    }
    if (validChildIds.length > 0) resolved.set(parentId, validChildIds);
  }

  // Depth check: a location declared as parent must NOT itself appear
  // as someone's child. We do this after the per-entry pass because
  // both sides come from the same JSON map and we need the full picture.
  for (const parentId of declaredParents) {
    if (claimedChildren.has(parentId)) {
      ctx.log.failure({
        file: "meta/LokaceHierarchie.json",
        reason: "hierarchy_depth_exceeded",
        details: `location ${parentId} is both a parent and a child — flatten the JSON`,
      });
      // Drop everything claiming this parent — we can't trust the
      // direction without the user resolving the ambiguity.
      resolved.delete(parentId);
    }
  }

  // A parent dropped by the depth check above takes its children's
  // map-default flags with it — keep mapDefaultChildIds in sync with
  // whatever survived in `resolved`.
  const survivingChildIds = new Set<number>();
  for (const arr of resolved.values())
    for (const id of arr) survivingChildIds.add(id);
  for (const id of [...mapDefaultChildIds]) {
    if (!survivingChildIds.has(id)) mapDefaultChildIds.delete(id);
  }

  if (ctx.opts.dryRun) {
    let totalChildren = 0;
    for (const arr of resolved.values()) totalChildren += arr.length;
    ctx.log.log({
      event: "hierarchy.plan",
      level: "info",
      would_set_parents: resolved.size,
      would_link_children: totalChildren,
      would_map_default: mapDefaultChildIds.size,
    });
    return;
  }

  // Second pass: clear every parent_id that points at one of the
  // parents we're about to (re)write — that frees up children which
  // were unlinked in the latest JSON edit. Reset their
  // show_on_map_by_default to false in the same sweep so a child that
  // dropped its `map: true` flag in the JSON gets cleared too. Then
  // bulk-set the new links and re-apply the map-default flags. This
  // keeps the whole operation idempotent even when the JSON shrinks.
  if (resolved.size > 0) {
    await ctx.prisma.location.updateMany({
      where: { parentId: { in: [...resolved.keys()] } },
      data: { parentId: null, showOnMapByDefault: false },
    });
    for (const [parentId, childIds] of resolved.entries()) {
      await ctx.prisma.location.updateMany({
        where: { id: { in: childIds } },
        data: { parentId },
      });
    }
    if (mapDefaultChildIds.size > 0) {
      await ctx.prisma.location.updateMany({
        where: { id: { in: [...mapDefaultChildIds] } },
        data: { showOnMapByDefault: true },
      });
    }
  }

  let appliedChildren = 0;
  for (const arr of resolved.values()) appliedChildren += arr.length;
  ctx.log.log({
    event: "hierarchy.done",
    level: "info",
    parents: resolved.size,
    children_linked: appliedChildren,
    map_default_children: mapDefaultChildIds.size,
    failures_logged: ctx.log.failures,
  });
}

// --------------------------------------------------------------------------
//  Reconcile phase — heal location-id drift
// --------------------------------------------------------------------------
//
// The fork path above (maps.location_forked) assigns id = max+1 when a
// MAP_ID slot is already held by a different code — which happens when
// location CODES get reshuffled across maps (a common /admin rename).
// That leaves a Location sitting on an id that none of its maps carry,
// so it shows up under the wrong "00xxx" and the real number "goes
// missing". This phase puts every such Location back onto its map's id.
//
// Safe by construction: the move set is closed (each occupied target is
// itself a drifted row that also moves), the plan orders moves so each
// target is free when its UPDATE runs, and every FK on locations.id is
// ON UPDATE CASCADE — so finds, maps and child parent_id follow the
// renumber automatically. Multi-map drift (ambiguous target) is logged
// and left for manual handling. Runs on full syncs only; dry-run plans
// without writing.

async function phaseReconcileLocationIds(ctx: Context): Promise<void> {
  const [locations, maps] = await Promise.all([
    ctx.prisma.location.findMany({ select: { id: true, code: true } }),
    ctx.prisma.locationMap.findMany({
      select: { id: true, locationId: true },
    }),
  ]);

  const { singleMapMoves, multiMapDrift } = computeLocationDrift(
    locations,
    maps,
  );

  for (const d of multiMapDrift) {
    ctx.log.log({
      event: "reconcile.multimap_skip",
      level: "warn",
      location_id: d.id,
      code: d.code,
      map_ids: d.mapIds,
      note: "location with several maps drifted — set the intended id by hand",
    });
  }

  if (singleMapMoves.length === 0) {
    if (multiMapDrift.length === 0) {
      ctx.log.log({ event: "reconcile.clean", level: "info" });
    }
    return;
  }

  let plan;
  try {
    plan = planLocationRenumber(
      singleMapMoves,
      locations.map((l) => l.id),
      maps.map((m) => m.id),
    );
  } catch (err) {
    ctx.log.log({
      event: "reconcile.plan_failed",
      level: "error",
      error: err instanceof Error ? err.message : String(err),
      note: "left untouched — run `pnpm diagnose:locations` to inspect",
    });
    return;
  }

  if (ctx.opts.dryRun) {
    ctx.log.log({
      event: "reconcile.plan",
      level: "info",
      would_renumber: plan.length,
      moves: plan.map((p) => ({ from: p.from, to: p.to, code: p.note })),
    });
    return;
  }

  await ctx.prisma.$transaction(async (tx) => {
    for (const mv of plan) {
      await tx.$executeRaw`UPDATE locations SET id = ${mv.to} WHERE id = ${mv.from}`;
    }
  });

  ctx.log.log({
    event: "reconcile.done",
    level: "info",
    renumbered: plan.length,
    moves: plan.map((p) => ({ from: p.from, to: p.to, code: p.note })),
  });
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
  const dbFindIds = (
    await ctx.prisma.find.findMany({ select: { id: true } })
  ).map((r) => r.id);
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

  // Auto-prune for maps + locations on every sync (no --prune flag
  // required). Renaming a map file in admin must reflect 1:1 in DB:
  // the old code disappears, the new one shows up. Same for hand
  // deletions on disk. Find rows + generated/ WebPs stay behind
  // --prune — those are riskier (a missing find file could be a
  // temporary rsync glitch, not a deliberate delete).
  if (ctx.opts.dryRun) {
    ctx.log.log({
      event: "prune.dryrun_auto",
      level: "info",
      note: "auto-prune of orphan maps+locations skipped (--dry-run)",
      would_delete_maps: orphanMaps.length,
      would_delete_locations: orphanLocations.length,
    });
  } else {
    if (orphanMaps.length > 0) {
      await ctx.prisma.locationMap.deleteMany({
        where: { id: { in: orphanMaps } },
      });
      ctx.log.log({
        event: "prune.auto_maps",
        level: "info",
        deleted: orphanMaps.length,
      });
    }
    if (orphanLocations.length > 0) {
      await ctx.prisma.location.deleteMany({
        where: { id: { in: orphanLocations } },
      });
      ctx.log.log({
        event: "prune.auto_locations",
        level: "info",
        deleted: orphanLocations.length,
      });
    }
  }

  if (!ctx.opts.prune) {
    if (orphanFinds.length > 0) {
      ctx.log.log({
        event: "prune.skipped_finds",
        level: "info",
        note: "pass --prune to delete orphan finds + free generated/",
        orphan_finds: orphanFinds.length,
      });
    }
    return;
  }

  if (ctx.opts.dryRun) {
    ctx.log.log({
      event: "prune.dryrun",
      level: "info",
      note: "no find deletions performed (--dry-run)",
      would_delete_finds: orphanFinds.length,
    });
    // Still scan generated/ so the user sees what would be freed.
    await pruneGeneratedFiles(ctx);
    return;
  }

  // Find delete cascades to FindImage rows. Maps + locations were
  // already cleaned above.
  if (orphanFinds.length > 0) {
    await ctx.prisma.find.deleteMany({ where: { id: { in: orphanFinds } } });
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
    event: ctx.opts.dryRun ? "prune.generated.dryrun" : "prune.generated.done",
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
function extractSha1FromGeneratedPath(
  value: string | null | undefined,
): string | null {
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
  /** Watermark to bake into newly-encoded find/crop WebPs. Null when no
   *  PNG was found at $DATA_DIR/meta/VODOZNAK_BezJmena.png — we don't
   *  abort the sync, we just produce un-watermarked variants. Existing
   *  files (skipped via the mtime fast-path or the WebP-cache fast-path)
   *  keep whatever watermark state they were last encoded with. */
  watermark: WatermarkSpec | null;
}

function countBy<T extends string>(values: readonly T[]): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // Captured before any DB writes so we can tell which finds this run
  // actually inserted (createdAt >= syncStart) for the IndexNow ping.
  const syncStart = new Date();

  const dataDir = process.env.DATA_DIR ?? "./data";
  const generatedDir = process.env.GENERATED_DIR ?? "./public/generated";

  const logsDir = "./logs";
  await mkdir(logsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const log = new Logger(
    join(logsDir, `sync-${ts}.log`),
    join(logsDir, `sync-failures-${ts}.jsonl`),
  );

  // Watermark: optional, loaded once. Missing file is fine — we just
  // generate bare WebPs (e.g. dev environments without the asset).
  // Loaded BEFORE sync.start so the chosen state is part of the run log.
  const watermarkPath = join(dataDir, "meta", "VODOZNAK_BezJmena.png");
  let watermark: WatermarkSpec | null = null;
  try {
    const buffer = await getWatermarkBuffer(
      watermarkPath,
      DEFAULT_WATERMARK_OPTIONS,
    );
    watermark = { buffer, options: DEFAULT_WATERMARK_OPTIONS };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      log.log({
        event: "watermark.invalid",
        level: "warn",
        path: watermarkPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const prisma = new PrismaClient();
  const ctx: Context = {
    opts,
    prisma,
    log,
    dataDir,
    generatedDir,
    watermark,
  };

  log.log({
    event: "sync.start",
    level: "info",
    dry_run: opts.dryRun,
    only: opts.only,
    data_dir: dataDir,
    generated_dir: generatedDir,
    watermark: watermark
      ? {
          path: watermarkPath,
          width_ratio: DEFAULT_WATERMARK_OPTIONS.widthRatio,
          opacity: DEFAULT_WATERMARK_OPTIONS.opacity,
          rotation: DEFAULT_WATERMARK_OPTIONS.rotation,
        }
      : null,
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

    // Hierarchy file is independent — its own JSON, its own loader. We
    // read it eagerly so a malformed file fails fast (before any
    // expensive image work), even though we only apply it during the
    // meta phase below.
    const hierarchyPath = join(dataDir, "meta", "LokaceHierarchie.json");
    let hierarchy: Hierarchy | null = null;
    try {
      hierarchy = await readHierarchy(hierarchyPath);
      if (hierarchy) {
        log.log({
          event: "hierarchy.loaded",
          level: "info",
          parents: Object.keys(hierarchy).length,
          children: Object.values(hierarchy).reduce(
            (acc, arr) => acc + arr.length,
            0,
          ),
        });
      }
    } catch (err: unknown) {
      log.log({
        event: "hierarchy.invalid",
        level: "warn",
        path: hierarchyPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const runMaps = opts.only === null || opts.only === "maps";
    const runFinds = opts.only === null || opts.only === "finds";
    // Hierarchy and main meta share the same scope flag — both are
    // declarative side-channels keyed by code, both need locations to
    // already be in place. Either file may be absent; the phase
    // functions handle the null case gracefully.
    const runMeta = opts.only === null || opts.only === "meta";

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

    if (runMeta) {
      if (meta) await phaseMeta(ctx, meta);
      await phaseHierarchy(ctx, hierarchy);
    }

    if (runFinds) {
      await phasePrune(ctx, allFinds, mapToLocation);
    }

    // Self-heal location-id drift left by the fork path when codes were
    // reshuffled across MAP_IDs. Full syncs only — targeted --only runs
    // stay surgical. Runs last so it reconciles the final DB state;
    // cascading FKs fix finds, maps and hierarchy along with it.
    if (opts.only === null) {
      await phaseReconcileLocationIds(ctx);
    }

    // IndexNow: nudge Bing / Seznam.cz / Yandex to crawl the newly-added
    // finds immediately (best-effort — localhost + dry-run are no-ops).
    // Only finds inserted THIS run (createdAt >= syncStart) and only
    // non-anonymized ones (anonymized finds are noindex, never submit
    // them). Failure here must never fail the sync.
    if (!opts.dryRun && runFinds) {
      try {
        const fresh = await prisma.find.findMany({
          where: { createdAt: { gte: syncStart }, isAnonymized: false },
          select: { id: true },
        });
        if (fresh.length > 0) {
          const res = await pingIndexNow(fresh.map((f) => findUrl(f.id)));
          log.log({
            event: "indexnow.ping",
            level: "info",
            new_finds: fresh.length,
            submitted: res.submitted,
            ok: res.ok,
            status: res.status ?? null,
            skipped: res.skipped ?? null,
          });
        }
      } catch (err: unknown) {
        log.log({
          event: "indexnow.failed",
          level: "warn",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Nudge the running Next server to drop its stats + ISR caches so
    // /statistiky and the home stat panels reflect this sync immediately
    // instead of waiting out their revalidate window. Best-effort, localhost
    // only, no-op without REVALIDATE_TOKEN (see src/lib/revalidatePing.ts).
    if (!opts.dryRun) {
      const rv = await pingRevalidate();
      log.log({
        event: "revalidate.ping",
        level: rv.ok ? "info" : "warn",
        ok: rv.ok,
        status: rv.status ?? null,
        skipped: rv.skipped ?? null,
      });
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
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await log.close();
  }
}

main();
