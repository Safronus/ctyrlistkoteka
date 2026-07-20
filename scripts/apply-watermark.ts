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
 *   pnpm watermark --all --regenerate --concurrency 6   # N images in parallel (default = CPU count)
 *   pnpm watermark --find-id 1 --regenerate   # re-encode WebP from source first
 *   pnpm watermark --find-id 1 --regen-only   # regen without applying the mark
 *   pnpm watermark --all --relight-below 120 --opacity 1 --dry-run  # preview
 *   pnpm watermark --all --relight-below 120 --opacity 1            # apply
 *
 * Relight (`--relight-below N`): re-encodes ONLY the photos whose bottom-right
 * corner luminance is < N and skips the rest WITHOUT the expensive source
 * regen — it samples each corner cheaply from the already-generated web WebP.
 * The re-encode applies the CURRENT adaptive colour (pale primary, dark on
 * bright highlights — see `DEFAULT_WATERMARK_OPTIONS`), so this is a way to
 * re-touch just a corner-luminance-selected subset. Run with `--dry-run`
 * first: it prints the corner-luminance histogram across the whole collection
 * so you can pick N from real data. NOTE: relight rewrites files at their
 * existing sha1 URLs, so bump FIND_PHOTO_ASSET_VERSION afterwards (see
 * src/lib/constants.ts) or browsers keep the cached copy.
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
import { cpus } from "node:os";
import sharp from "sharp";
import { ImageType, PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient } from "@/lib/prismaClient";
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
  /** Targeted "relight" mode: re-encode ONLY photos whose bottom-right corner
   *  luminance is < this value (0–255); brighter-corner photos are skipped
   *  WITHOUT the expensive regen. The re-encode applies the current adaptive
   *  colour (see `DEFAULT_WATERMARK_OPTIONS`). Null = the normal (non-relight)
   *  sweep. See `sampleCornerLuma`. */
  relightBelow: number | null;
  /** How many images to process concurrently. Defaults to the CPU count.
   *  Each task runs sharp single-threaded (sharp.concurrency(1)), so the
   *  pool — not libvips — provides the parallelism. */
  concurrency: number;
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
    concurrency: Math.max(1, cpus().length),
    relightBelow: null,
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
    if (a === "--find-id") args.findId = Number.parseInt(need(a), 10);
    else if (a === "--all") args.all = true;
    else if (a === "--watermark") args.watermarkPath = need(a);
    else if (a === "--width-ratio")
      args.options.widthRatio = Number.parseFloat(need(a));
    else if (a === "--opacity") args.options.opacity = Number.parseFloat(need(a));
    else if (a === "--margin-ratio")
      args.options.marginRatio = Number.parseFloat(need(a));
    else if (a === "--rotation")
      args.options.rotation = Number.parseFloat(need(a));
    else if (a === "--concurrency")
      args.concurrency = Math.max(1, Number.parseInt(need(a), 10));
    else if (a === "--relight-below") {
      // Targeted re-light: only re-encode photos with a dark bottom-right
      // corner. Forces regenerate (must re-encode from source to rebake the
      // mark with the current adaptive colour).
      args.relightBelow = Number.parseInt(need(a), 10);
      args.regenerate = true;
    }
    else if (a === "--skip-thumbs") args.skipThumbs = true;
    else if (a === "--reset") args.reset = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--regenerate") args.regenerate = true;
    else if (a === "--regen-only") {
      args.regenerate = true;
      args.regenOnly = true;
    } else if (a === "--web-quality") args.webQuality = Number.parseInt(need(a), 10);
    else if (a === "--thumb-quality")
      args.thumbQuality = Number.parseInt(need(a), 10);
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: pnpm watermark [--find-id N | --all] [--watermark PATH]\n" +
          "                     [--width-ratio 0.10] [--opacity 0.40] [--margin-ratio 0.02]\n" +
          "                     [--rotation 45]    (degrees, CCW positive)\n" +
          "                     [--skip-thumbs] [--reset] [--dry-run]\n" +
          "                     [--regenerate | --regen-only]\n" +
          "                     [--relight-below 120] [--web-quality 85] [--thumb-quality 80]\n\n" +
          "  --regenerate   Re-encode WebP from the original file before watermarking.\n" +
          "                 Use this when iterating on watermark parameters or after a\n" +
          "                 botched run baked artifacts in.\n" +
          "  --regen-only   Same regen, but skip the watermark step (recovery only).\n" +
          "  --relight-below N  Targeted re-touch: re-encode ONLY photos whose bottom-\n" +
          "                 right corner luminance is < N (0–255) with the current\n" +
          "                 adaptive colour; brighter-corner photos are skipped without\n" +
          "                 a regen. Implies --regenerate. Pair with --dry-run first to\n" +
          "                 see the corner-luminance histogram and how many photos each\n" +
          "                 threshold would touch.",
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
  if (args.relightBelow !== null) {
    if (
      Number.isNaN(args.relightBelow) ||
      args.relightBelow <= 0 ||
      args.relightBelow > 255
    ) {
      console.error("--relight-below must be a luminance in 1–255.");
      process.exit(2);
    }
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
  const j: Sentinel = {
    watermarkedSha1s: [...set].sort((a, b) => a.localeCompare(b)),
  };
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
): Promise<{ width: number; height: number }> {
  const src = await findSourceFile(searchRoots, filename);
  if (!src) {
    throw new Error(
      `source not found in [${searchRoots.join(", ")}] (basename: ${filename})`,
    );
  }
  // Pass expected sha1 to avoid re-hashing — we trust the DB row.
  // forceRegen overrides the "fast path" cache so the existing (possibly
  // corrupted) WebP gets overwritten cleanly. Return the encoded dimensions:
  // generateWebPVariants may re-orient landscape → portrait, so the caller
  // must write the new width/height back to the DB (the display's
  // rotate/aspect logic reads them from there).
  const out = await generateWebPVariants({
    sourcePath: src,
    generatedDir,
    forceRegen: true,
    sha1: expectedSha1,
  });
  return { width: out.width, height: out.height };
}

async function applyWatermarkInPlace(
  filePath: string,
  watermarkBuf: Buffer,
  opts: WatermarkOptions,
  webpQuality: number,
): Promise<{ width: number; height: number }> {
  const sharp = require("sharp") as typeof import("sharp").default;
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

/** Mean luminance (Rec.601, 0–255) of a proxy of the bottom-right corner,
 *  read from the CURRENT web WebP. The box is a 15%-of-dimension square in the
 *  bottom-right region, shifted up-left so its far corner sits at ~83% of the
 *  width/height — adjacent to, but clear of, the baked watermark (which sits in
 *  the innermost ~12% corner). The clean photo brightness here tracks the exact
 *  rectangle the adaptive composite samples, without the mark contaminating it,
 *  so relight can decide whether a photo is dark enough for the pale mark
 *  WITHOUT decoding the (much larger, possibly HEIC) original. */
async function sampleCornerLuma(webFs: string): Promise<number> {
  const sharp = require("sharp") as typeof import("sharp").default;
  const buf = await readFile(webFs);
  const meta = await sharp(buf, { failOn: "none" }).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error(`unreadable image: ${webFs}`);
  const bw = Math.max(1, Math.round(W * 0.15));
  const bh = Math.max(1, Math.round(H * 0.15));
  const left = Math.max(0, Math.round(W * 0.83) - bw);
  const top = Math.max(0, Math.round(H * 0.83) - bh);
  const st = await sharp(buf, { failOn: "none" })
    .extract({ left, top, width: bw, height: bh })
    .stats();
  const [r, g, b] = st.channels;
  return 0.299 * (r?.mean ?? 0) + 0.587 * (g?.mean ?? 0) + 0.114 * (b?.mean ?? 0);
}

/** Prints the corner-luminance distribution collected during a relight run so
 *  the operator can pick a threshold from the real collection, not a guess. */
function printRelightHistogram(lumas: number[], chosen: number): void {
  if (lumas.length === 0) return;
  const lu = [...lumas].sort((a, b) => a - b);
  const q = (p: number): number => lu[Math.floor(p * (lu.length - 1))] ?? 0;
  const r = (x: number): number => Math.round(x);
  console.log(
    `\nCorner luminance across ${lu.length} images (bottom-right proxy):`,
  );
  console.log(
    `  min=${r(lu[0] ?? 0)} p10=${r(q(0.1))} p25=${r(q(0.25))} ` +
      `median=${r(q(0.5))} p75=${r(q(0.75))} max=${r(lu[lu.length - 1] ?? 0)}`,
  );
  for (const t of [95, 110, 120, 130, 140, 150]) {
    const n = lu.filter((x) => x < t).length;
    const pct = ((100 * n) / lu.length).toFixed(0);
    console.log(
      `  corner < ${t}: ${n} (${pct}%)${t === chosen ? "   ← this run" : ""}`,
    );
  }
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
  if (args.relightBelow !== null) {
    console.log(
      `relight   : re-encode photos with bottom-right corner luma < ${args.relightBelow} ` +
        `→ pale mark (brighter corners skipped)`,
    );
  }

  const watermarkBuf = await getWatermarkBuffer(
    args.watermarkPath,
    args.options,
  );

  const prisma = createPrismaClient();
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
    let lastPersist = 0;
    const startedAt = Date.now();
    const isAllRun = args.findId === null;
    const total = images.length;
    // Corner luminances gathered in relight mode (for the summary histogram).
    const relightLumas: number[] = [];

    // Each task runs sharp single-threaded; the worker pool below — not
    // libvips per-op threading — provides the parallelism, so N cores stay
    // busy on N different images (WebP encode is single-threaded in libvips,
    // which is exactly what left cores idle in the old serial sweep).
    // Single-threaded sharp per task + the worker pool below = clean N-core
    // parallelism. Relight's dry-run still samples every file, so it wants the
    // pool too; only a plain (non-relight) dry-run does no image work.
    if (!args.dryRun || args.relightBelow !== null) sharp.concurrency(1);
    const workers = Math.max(1, Math.min(args.concurrency, total));
    console.log(`workers   : ${workers} (sharp single-threaded per task)`);

    async function processImage(img: (typeof images)[number]): Promise<void> {
      const tag = img.imageType === ImageType.CROP ? "CROP" : "ORIG";
      const webFs = webUrlToFsPath(img.webPath, generatedDir);
      const thumbFs = webUrlToFsPath(img.thumbPath, generatedDir);

      if (args.relightBelow !== null) {
        // Relight: sample the CLEAN corner of the current web file and only
        // proceed for photos dark enough to now qualify for the pale mark.
        // Sampled for EVERY image (cheap: small WebP, tiny crop) so bright-
        // corner photos are skipped without the expensive source regen.
        // Bypasses the sentinel — a relight is a deliberate re-do of a subset.
        let luma: number;
        try {
          luma = await sampleCornerLuma(webFs);
        } catch (err) {
          failed += 1;
          console.error(
            `✗ find ${img.findId} (${tag}) corner sample ${webFs}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return;
        }
        relightLumas.push(luma);
        if (luma >= args.relightBelow) {
          skipped += 1;
          return;
        }
        if (args.dryRun) {
          console.log(
            `[dry] find ${String(img.findId).padStart(5, "0")} ${tag} relight ` +
              `(corner ${Math.round(luma)} < ${args.relightBelow})`,
          );
          done += 1;
          return;
        }
        // Dark enough → fall through to the regen + rewatermark below.
      } else if (isAllRun && processed.has(img.originalSha1)) {
        // For --all, honor the sentinel. For --find-id we always reprocess
        // (it's the manual verification path) — but still write to the
        // sentinel so a later --all skips it.
        skipped += 1;
        return;
      }

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
            //
            // ORIG and CROP can share the same basename (the user keeps
            // them parallel) but live in different roots — picking by
            // imageType is the only reliable way to disambiguate.
            // Earlier passes that searched both directories would find
            // the ORIG file for both rows and silently double-encode.
            const dataDir = process.env.DATA_DIR ?? "./data";
            const sourceRoot =
              img.imageType === ImageType.CROP
                ? join(dataDir, "crops")
                : join(dataDir, "finds");
            const dims = await regenerateFromSource(
              img.originalFilename,
              img.originalSha1,
              [sourceRoot],
              generatedDir,
            );
            // Regeneration may re-orient landscape → portrait, changing the
            // stored dimensions. Write them back so the display's rotate /
            // aspect logic (photoDisplay reads width/height off the DB row)
            // matches the file — otherwise a now-portrait image with stale
            // landscape dims would be rotated again on the detail page.
            await prisma.findImage.update({
              where: { id: img.id },
              data: dims,
            });
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

      // Persist the sentinel + print an ETA every ~200 completions. The
      // check-and-set of `lastPersist` is synchronous, so exactly one task
      // crosses each threshold — no overlapping writes.
      if (!args.dryRun && done - lastPersist >= 200) {
        lastPersist = done;
        await writeSentinel(sentinelPath, processed);
        const el = (Date.now() - startedAt) / 1000;
        const rate = el > 0 ? done / el : 0;
        const remaining = Math.max(0, total - done - skipped);
        const etaMin = rate > 0 ? remaining / rate / 60 : 0;
        console.log(
          `  … ${done + skipped}/${total} · ${rate.toFixed(1)} img/s · ` +
            `ETA ~${etaMin.toFixed(0)} min · failed ${failed}`,
        );
      }
    }

    // Worker pool: `workers` tasks each pull the next image off a shared
    // cursor until the list is exhausted. Safe because JS is single-threaded
    // — the cursor increment and the counter/`processed` mutations never
    // interleave mid-statement.
    let cursor = 0;
    async function worker(): Promise<void> {
      while (cursor < images.length) {
        const img = images[cursor++];
        if (img) await processImage(img);
      }
    }
    await Promise.all(Array.from({ length: workers }, () => worker()));

    if (!args.dryRun) {
      await writeSentinel(sentinelPath, processed);
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `\nDone in ${elapsed}s — processed ${done}, skipped ${skipped}, failed ${failed}.`,
    );
    if (args.relightBelow !== null) {
      printRelightHistogram(relightLumas, args.relightBelow);
    }
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
