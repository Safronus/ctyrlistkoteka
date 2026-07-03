/**
 * Backfill `{sha}-thumb.webp` for every location map already generated in
 * `${GENERATED_DIR}/maps/`. Run once on the VPS after deploying the map-
 * thumbnail change (A2). Idempotent — skips maps whose thumbnail already
 * exists (use `--force` to rebuild all). Fast: only ~128 maps, no DB, no
 * find images touched.
 *
 *   GENERATED_DIR=/var/ctyrlistkoteka/generated pnpm backfill-map-thumbs
 */
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { MAP_THUMB_QUALITY, MAP_THUMB_SIZE } from "../src/lib/constants";

const generatedDir =
  process.env.GENERATED_DIR ?? join(process.cwd(), "generated");
const mapsDir = join(generatedDir, "maps");

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  let files: string[];
  try {
    files = await readdir(mapsDir);
  } catch {
    console.error(`No maps directory at ${mapsDir} (set GENERATED_DIR?).`);
    process.exit(1);
  }
  const maps = files.filter(
    (f) => f.endsWith(".webp") && !f.endsWith("-thumb.webp"),
  );
  let made = 0;
  let skipped = 0;
  for (const f of maps) {
    const sha = f.replace(/\.webp$/, "");
    const thumbFs = join(mapsDir, `${sha}-thumb.webp`);
    if (!force && (await exists(thumbFs))) {
      skipped++;
      continue;
    }
    const buf = await readFile(join(mapsDir, f));
    const thumb = await sharp(buf, { failOn: "none" })
      .resize({
        width: MAP_THUMB_SIZE,
        height: MAP_THUMB_SIZE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: MAP_THUMB_QUALITY })
      .toBuffer();
    await writeFile(thumbFs, thumb);
    made++;
  }
  console.log(
    `Map thumbnails: ${made} generated, ${skipped} already present (of ${maps.length} maps).`,
  );
}

void main();
