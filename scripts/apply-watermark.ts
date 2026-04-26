/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * One-shot watermark sweep over already-generated WebP variants in
 * `$GENERATED_DIR/{web,thumb}/`. Reads find_images rows from the DB,
 * resolves the on-disk path of each web + thumb WebP, and bakes the
 * watermark in-place. Original HEIC/JPEG files are never touched.
 *
 * Usage:
 *   pnpm watermark --find-id 1
 *   pnpm watermark --all
 *   pnpm watermark --all --width-ratio 0.25 --opacity 0.35
 *   pnpm watermark --watermark /path/to/custom.png --find-id 42
 *   pnpm watermark --all --skip-thumbs    # web only
 *   pnpm watermark --all --reset          # ignore sentinel, redo everything
 *   pnpm watermark --find-id 1 --regenerate   # re-encode WebP from source first
 *   pnpm watermark --find-id 1 --regen-only   # regen without applying the mark
 *
 * Idempotence: a sentinel file `$GENERATED_DIR/.watermarked.json` tracks
 * the SHA-1s already processed during a `--all` run. Re-running skips
 * them so a crash or interrupt is safe to resume. `--find-id N` ignores
 * the sentinel because it's a manual one-off (e.g. the verification on
 * find #1 the user requested), but does write the SHA-1s in so the
 * subsequent `--all` run skips them.
 *
 * `--regenerate` is the cleanest way to iterate on watermark parameters:
 * it locates the original file in DATA_DIR/finds (recursive walk,
 * matching `original_filename`), re-encodes the WebP from source via
 * generateWebPVariants(forceRegen: true), and only then composites the
 * watermark. Use it whenever a previous broken run baked artifacts in.
 */

import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageType, PrismaClient } from "@prisma/client";
import { WEB_QUALITY, THUMB_QUALITY } from "../src/lib/constants";
import { generateWebPVariants } from "../src/lib/images";
import {
  DEFAULT_WATERMARK_OPTIONS,
  compositeWatermarkOnto,
  getWatermarkBuffer,
  type WatermarkOptions,
} from "../src/lib/watermark";

interface Args {
  findId: number | null;
  all: boolean;
  watermarkPath: string;
  options: WatermarkOptions;
  skipThumbs: boolean;
  reset: boolean;
  dryRun: boolean;
  regenerate: boolean;
  regenOnly: boolean;
  webQuality: number;
  thumbQuality: number;
}

function parseArgs(argv: string[]): Args {
  const dataDir = process.env.DATA_DIR ?? "./data";
  const args: Args = {
    findId: null,
    all: false,
    watermarkPath: join(dataDir, "meta", "VODOZNAK_BezJmena.png"),
    options: { ...DEFAULT_WATERMARK_OPTIONS },
    skipThumbs: false,
    reset: false,
    dryRun: false,
    regenerate: false,
    regenOnly: false,
    webQuality: WEB_QUALITY,
    thumbQuality: THUMB_QUALITY,
  };
  const cur = { i: 0 };
  const need = (flag: string): string => {
    const v = argv[++cur.i];
    if (v === undefined) {
      console.error(`${flag} requires a value`);
      process.exit(2);
    }
    return v;
  };
  for (cur.i = 0; cur.i < argv.length; cur.i++) {
    const a = argv[cur.i];
    if (a === "--find-id") args.findId = parseInt(need(a), 10);
    else if (a === "--all") args.all = true;
    else if (a === "--watermark") args.watermarkPath = need(a);
    else if (a === "--width-ratio")
      args.options.widthRatio = parseFloat(need(a));
    else if (a === "--opacity") args.options.opacity = parseFloat(need(a));
    else if (a === "--margin-ratio")
      args.options.marginRatio = parseFloat(need(a));
    else if (a === "--rotation")
      args.options.rotation = parseFloat(need(a));
    else if (a === "--skip-thumbs") args.skipThumbs = true;
    else if (a === "--reset") args.reset = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--regenerate") args.regenerate = true;
    else if (a === "--regen-only") {
      args.regenerate = true;
      args.regenOnly = true;
    } else if (a === "--web-quality") args.webQuality = parseInt(need(a), 10);
    else if (a === "--thumb-quality")
      args.thumbQuality = parseInt(need(a), 10);
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: pnpm watermark [--find-id N | --all] [--watermark PATH]\n" +
          "                     [--width-ratio 0.10] [--opacity 0.40] [--margin-ratio 0.02]\n" +
          "                     [--rotation 45]    (degrees, CCW positive)\n" +
          "                     [--skip-thumbs] [--reset] [--dry-run]\n" +
          "                     [--regenerate | --regen-only]\n" +
          "                     [--web-quality 85] [--thumb-quality 80]\n\n" +
          "  --regenerate   Re-encode WebP from the original file before watermarking.\n" +
          "                 Use this when iterating on watermark parameters or after a\n" +
          "                 botched run baked artifacts in.\n" +
          "  --regen-only   Same regen, but skip the watermark step (recovery only).",
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (args.findId === null && !args.all) {
    console.error("Specify --find-id N or --all.");
    process.exit(2);
  }
  if (args.findId !== null && (Number.isNaN(args.findId) || args.findId <= 0)) {
    console.error("--find-id must be a positive integer.");
    process.exit(2);
  }
  return args;
}

interface Sentinel {
  watermarkedSha1s: string[];
}

async function readSentinel(path: string): Promise<Set<string>> {
  try {
    const raw = await readFile(path, "utf8");
    const j = JSON.parse(raw) as Sentinel;
    return new Set(j.watermarkedSha1s ?? []);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw e;
  }
}

async function writeSentinel(path: string, set: Set<string>): Promise<void> {
  const j: Sentinel = { watermarkedSha1s: [...set].sort() };
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(j, null, 2));
  await rename(tmp, path);
}

/** Public web URL → filesystem path (`/generated/web/x.webp` →
 *  `$GENERATED_DIR/web/x.webp`). The web URL is what the DB stores; the
 *  on-disk file lives at `$GENERATED_DIR + URL.replace(/^\/generated/, '')`. */
function webUrlToFsPath(url: string, generatedDir: string): string {
  const stripped = url.replace(/^\/generated\//, "");
  return join(generatedDir, stripped);
}

/** Walks the given root directories recursively to locate a source file
 *  by basename. find_images stores only the basename (no path) so we
 *  rely on the filename being unique across the searched roots —
 *  sync.ts enforces this when importing. Returns null when the file
 *  isn't on disk (e.g. user moved or deleted the original). */
async function findSourceFile(
  rootDirs: ReadonlyArray<string>,
  filename: string,
): Promise<string | null> {
  for (const root of rootDirs) {
    const stack: string[] = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw e;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (e.isFile() && e.name === filename) return full;
      }
    }
  }
  return null;
}

async function regenerateFromSource(
  filename: string,
  expectedSha1: string,
  searchRoots: ReadonlyArray<string>,
  generatedDir: string,
): Promise<void> {
  const src = await findSourceFile(searchRoots, filename);
  if (!src) {
    throw new Error(
      `source not found in [${searchRoots.join(", ")}] (basename: ${filename})`,
    );
  }
  // Pass expected sha1 to avoid re-hashing — we trust the DB row.
  // forceRegen overrides the "fast path" cache so the existing (possibly
  // corrupted) WebP gets overwritten cleanly.
  await generateWebPVariants({
    sourcePath: src,
    generatedDir,
    forceRegen: true,
    sha1: expectedSha1,
  });
}

async function applyWatermarkInPlace(
  filePath: string,
  watermarkBuf: Buffer,
  opts: WatermarkOptions,
  webpQuality: number,
): Promise<{ width: number; height: number }> {
  const sharp = require("sharp") as typeof import("sharp");
  // Decode the existing WebP. We read the file fully so the file handle
  // is closed before we overwrite — sharp().toFile(samePath) would race.
  const buf = await readFile(filePath);
  const decoded = sharp(buf, { failOn: "none" });
  const meta = await decoded.metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error(`unreadable image: ${filePath}`);
  const composited = await compositeWatermarkOnto(
    decoded,
    W,
    H,
    watermarkBuf,
    opts,
  );
  const out = await composited.webp({ quality: webpQuality }).toBuffer();
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, out);
  await rename(tmp, filePath);
  return { width: W, height: H };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const generatedDir =
    process.env.GENERATED_DIR ?? "./public/generated";
  const sentinelPath = join(generatedDir, ".watermarked.json");

  // Validate watermark file before opening DB.
  await stat(args.watermarkPath).catch(() => {
    console.error(
      `Watermark file not found: ${args.watermarkPath}\n` +
        `Place it there or pass --watermark <path>.`,
    );
    process.exit(1);
  });

  console.log(`watermark : ${args.watermarkPath}`);
  console.log(
    `options   : width=${(args.options.widthRatio * 100).toFixed(1)}% ` +
      `opacity=${(args.options.opacity * 100).toFixed(0)}% ` +
      `margin=${(args.options.marginRatio * 100).toFixed(1)}% ` +
      `rotation=${args.options.rotation.toFixed(0)}° (CCW)`,
  );
  console.log(
    `targets   : ${args.skipThumbs ? "web only" : "web + thumb"}`,
  );

  const watermarkBuf = await getWatermarkBuffer(
    args.watermarkPath,
    args.options,
  );

  const prisma = new PrismaClient();
  try {
    const where = args.findId !== null ? { findId: args.findId } : {};
    const images = await prisma.findImage.findMany({
      where,
      select: {
        id: true,
        findId: true,
        imageType: true,
        originalSha1: true,
        originalFilename: true,
        webPath: true,
        thumbPath: true,
      },
      orderBy: [{ findId: "asc" }, { id: "asc" }],
    });

    if (images.length === 0) {
      console.log("No find_images matched.");
      return;
    }

    let processed = await readSentinel(sentinelPath);
    if (args.reset) {
      console.log(`reset     : clearing sentinel (${processed.size} sha1s)`);
      processed = new Set();
    }

    let done = 0;
    let skipped = 0;
    let failed = 0;
    const startedAt = Date.now();
    const isAllRun = args.findId === null;

    for (const img of images) {
      const tag =
        img.imageType === ImageType.CROP ? "CROP" : "ORIG";
      // For --all, honor the sentinel. For --find-id we always reprocess
      // (it's the manual verification path) — but still write to the
      // sentinel so a later --all skips it.
      if (isAllRun && processed.has(img.originalSha1)) {
        skipped += 1;
        continue;
      }
      const webFs = webUrlToFsPath(img.webPath, generatedDir);
      const thumbFs = webUrlToFsPath(img.thumbPath, generatedDir);

      try {
        if (args.dryRun) {
          const regenNote = args.regenerate ? " [+regen]" : "";
          const wmNote = args.regenOnly ? " [no-mark]" : "";
          console.log(
            `[dry] find ${String(img.findId).padStart(5, "0")} ${tag}${regenNote}${wmNote} ` +
              `web=${webFs}${args.skipThumbs ? "" : ` thumb=${thumbFs}`}`,
          );
        } else {
          if (args.regenerate) {
            // Re-encode WebP from the original HEIC/JPEG, overwriting any
            // previous (potentially corrupted) variants. Done before
            // watermarking so the doodle gets composed over a clean photo.
            // Search both finds/ (ORIGINAL) and crops/ (CROP) — sync.ts
            // walks both, and the imageType column tells us which is
            // which but the basename is enough to locate either.
            const dataDir = process.env.DATA_DIR ?? "./data";
            await regenerateFromSource(
              img.originalFilename,
              img.originalSha1,
              [join(dataDir, "finds"), join(dataDir, "crops")],
              generatedDir,
            );
          }
          if (args.regenOnly) {
            console.log(
              `↻ find ${String(img.findId).padStart(5, "0")} ${tag} regenerated`,
            );
          } else {
            const w = await applyWatermarkInPlace(
              webFs,
              watermarkBuf,
              args.options,
              args.webQuality,
            );
            let extra = "";
            if (!args.skipThumbs) {
              const t = await applyWatermarkInPlace(
                thumbFs,
                watermarkBuf,
                args.options,
                args.thumbQuality,
              );
              extra = ` (thumb ${t.width}×${t.height})`;
            }
            const regenPrefix = args.regenerate ? "↻ " : "";
            console.log(
              `${regenPrefix}✓ find ${String(img.findId).padStart(5, "0")} ${tag} ` +
                `${w.width}×${w.height}${extra}`,
            );
            processed.add(img.originalSha1);
          }
        }
        done += 1;
      } catch (err) {
        failed += 1;
        console.error(
          `✗ find ${img.findId} (${tag}) ${img.webPath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      // Persist sentinel periodically so crash mid-sweep doesn't lose
      // progress. Cheap: ~17k entries, JSON < 1 MB.
      if (!args.dryRun && done > 0 && done % 50 === 0) {
        await writeSentinel(sentinelPath, processed);
      }
    }

    if (!args.dryRun) {
      await writeSentinel(sentinelPath, processed);
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `\nDone in ${elapsed}s — processed ${done}, skipped ${skipped}, failed ${failed}.`,
    );
    if (!args.dryRun) {
      console.log(`Sentinel: ${sentinelPath}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
