#!/usr/bin/env node

/**
 * prepare-upload.ts
 *
 * Lokální skript pro přípravu obrázků před uploadem na VPS.
 * Převádí HEIC/JPEG/PNG na optimalizovaný JPEG se zachovanými EXIF metadaty.
 *
 * Vstup:  složka s originálními soubory (HEIC, JPEG, PNG)
 * Výstup: složka s upload-ready JPEG soubory (~300 KB, max 2000 px)
 *
 * Použití:
 *   npx tsx scripts/prepare-upload.ts \
 *     --input ~/ctyrlistkoteka-archiv/originals/finds \
 *     --output ~/ctyrlistkoteka-archiv/upload-ready/finds \
 *     --max-width 2000 \
 *     --quality 82
 *
 *   # Pro výřezy (crops):
 *   npx tsx scripts/prepare-upload.ts \
 *     --input ~/ctyrlistkoteka-archiv/originals/crops \
 *     --output ~/ctyrlistkoteka-archiv/upload-ready/crops \
 *     --max-width 1200 \
 *     --quality 80
 *
 *   # Dry run — jen spočítá kolik souborů a odhadne velikost:
 *   npx tsx scripts/prepare-upload.ts \
 *     --input ~/ctyrlistkoteka-archiv/originals/finds \
 *     --output ~/ctyrlistkoteka-archiv/upload-ready/finds \
 *     --dry-run
 *
 * Požadavky (lokální PC):
 *   npm install sharp heic-convert
 *   (sharp automaticky obsahuje libvips, heic-convert řeší HEIC dekódování)
 *
 * DŮLEŽITÉ:
 *   - Zachovává EXIF metadata (GPS, DateTimeOriginal, orientace)
 *   - Zachovává původní název souboru (mění jen příponu na .jpg)
 *   - Přeskočí soubory, které už v output složce existují (idempotentní)
 *   - Nemodifikuje originály
 */

import { readdir, stat, mkdir, access } from 'node:fs/promises';
import { join, extname, basename, parse as parsePath } from 'node:path';
import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Lazy imports (mohou chybět, skript vysvětlí co nainstalovat)
let sharp: typeof import('sharp');
let heicConvert: typeof import('heic-convert');

async function loadDependencies() {
  try {
    sharp = (await import('sharp')).default as any;
  } catch {
    console.error('❌ Chybí balíček "sharp". Nainstalujte ho:');
    console.error('   npm install sharp');
    process.exit(1);
  }
  try {
    heicConvert = (await import('heic-convert')).default as any;
  } catch {
    console.error('❌ Chybí balíček "heic-convert". Nainstalujte ho:');
    console.error('   npm install heic-convert');
    process.exit(1);
  }
}

// --- CLI argumenty ---

const { values: args } = parseArgs({
  options: {
    input:       { type: 'string', short: 'i' },
    output:      { type: 'string', short: 'o' },
    'max-width': { type: 'string', default: '2000' },
    quality:     { type: 'string', default: '82' },
    'dry-run':   { type: 'boolean', default: false },
    'force':     { type: 'boolean', default: false },
    'parallel':  { type: 'string', default: '4' },
    'verbose':   { type: 'boolean', short: 'v', default: false },
  },
  strict: true,
});

if (!args.input || !args.output) {
  console.error('Použití: npx tsx scripts/prepare-upload.ts --input <složka> --output <složka>');
  console.error('Volitelné: --max-width 2000 --quality 82 --dry-run --force --parallel 4 --verbose');
  process.exit(1);
}

const INPUT_DIR   = args.input;
const OUTPUT_DIR  = args.output;
const MAX_WIDTH   = parseInt(args['max-width']!, 10);
const QUALITY     = parseInt(args.quality!, 10);
const DRY_RUN     = args['dry-run']!;
const FORCE       = args.force!;
const PARALLEL    = parseInt(args.parallel!, 10);
const VERBOSE     = args.verbose!;

const IMAGE_EXTENSIONS = new Set(['.heic', '.heif', '.jpeg', '.jpg', '.png']);

// --- Pomocné funkce ---

function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(filename).toLowerCase());
}

function outputFilename(originalName: string): string {
  const { name } = parsePath(originalName);
  return `${name}.jpg`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// --- Konverze jednoho souboru ---

async function convertFile(
  inputPath: string,
  outputPath: string,
): Promise<{ inputSize: number; outputSize: number; skipped: boolean }> {
  const inputStat = await stat(inputPath);
  const inputSize = inputStat.size;

  // Přeskočit pokud output existuje a není --force
  if (!FORCE && await fileExists(outputPath)) {
    return { inputSize, outputSize: 0, skipped: true };
  }

  const ext = extname(inputPath).toLowerCase();
  let inputBuffer = await import('node:fs').then(fs =>
    fs.promises.readFile(inputPath)
  );

  // HEIC → JPEG buffer (heic-convert)
  if (ext === '.heic' || ext === '.heif') {
    const converted = await (heicConvert as any)({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: 1, // max kvalita, sharp ji pak sníží
    });
    inputBuffer = Buffer.from(converted);
  }

  // sharp: resize + JPEG komprese + ZACHOVAT EXIF
  const image = (sharp as any)(inputBuffer);

  const metadata = await image.metadata();
  const needsResize = metadata.width && metadata.width > MAX_WIDTH;

  let pipeline = image;
  if (needsResize) {
    pipeline = pipeline.resize({
      width: MAX_WIDTH,
      withoutEnlargement: true,
    });
  }

  // .withMetadata() zachovává EXIF v JPEG → JPEG pipeline. Pro HEIC ale
  // heic-convert zahodí veškerý EXIF už při dekódování → sharp tu nemá
  // co zachovat. Řešíme tím, že po zápisu JPEG zkopírujeme EXIF z
  // originálu přes exiftool (krok níže).
  // .rotate() aplikuje EXIF orientaci do pixelů (mobily často ukládají
  //   fotky otočené jen v EXIF, ne v pixelech).
  const outputBuffer = await pipeline
    .rotate()          // aplikuj EXIF orientaci
    .withMetadata()    // zachovej co sharp ještě má (JPEG vstupy)
    .jpeg({
      quality: QUALITY,
      mozjpeg: true,   // lepší komprese
    })
    .toBuffer();

  const fs = await import('node:fs');
  await fs.promises.writeFile(outputPath, outputBuffer);

  // Pro HEIC vstupy obnov EXIF z originálu — heic-convert ho zahodil.
  // Orientation se resetuje na 1, protože sharp.rotate() už pixely
  // natočil; jinak by viewer rotaci aplikoval podruhé.
  if (ext === '.heic' || ext === '.heif') {
    await copyExifFromOriginal(inputPath, outputPath);
  }

  // Zachovat datum souboru z originálu (mtime + atime). Musí být po
  // exiftool kroku, protože ten by jinak mtime přepsal.
  await fs.promises.utimes(outputPath, inputStat.atime, inputStat.mtime);

  const outputSize = outputBuffer.length;

  if (VERBOSE) {
    const ratio = ((1 - outputSize / inputSize) * 100).toFixed(0);
    const dims = metadata.width && metadata.height
      ? `${metadata.width}×${metadata.height}`
      : '?';
    const newWidth = needsResize ? MAX_WIDTH : metadata.width;
    console.log(
      `  ✓ ${basename(inputPath)} ${dims}→${newWidth}px ` +
      `${formatSize(inputSize)}→${formatSize(outputSize)} (−${ratio}%)`
    );
  }

  return { inputSize, outputSize, skipped: false };
}

// --- EXIF zotavení z originálu přes exiftool ---

let exiftoolWarned = false;

/**
 * Kopíruje veškerý EXIF z originálu do už-vyrobeného JPEG. Volá se po
 * sharp pipeline pro HEIC vstupy (tam EXIF zmizí během heic-convert).
 * Orientation je vynulovaná (1 = bez rotace), protože sharp.rotate() už
 * pixely otočil podle původní orientace.
 *
 * Vyžaduje `exiftool` v PATH (na macOS: `brew install exiftool`).
 * Při selhání jen varuje — JPEG zůstane bez EXIF, ale je použitelný.
 */
async function copyExifFromOriginal(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  try {
    await execFileAsync('exiftool', [
      '-overwrite_original',
      '-m',                           // tolerantní k drobným chybám
      '-TagsFromFile', sourcePath,
      '-all:all>all:all',             // zkopíruj všechny tagy
      '-Orientation=1',               // reset; pixely jsou už správně
      targetPath,
    ]);
  } catch (err: any) {
    if (!exiftoolWarned) {
      exiftoolWarned = true;
      console.warn(
        `\n⚠️  exiftool nedostupný nebo selhal: ${err.message?.split('\n')[0] ?? err}`
      );
      console.warn(
        '   HEIC fotky budou bez GPS/datumu v EXIF. Nainstaluj přes:'
      );
      console.warn('     brew install exiftool');
    }
  }
}

// --- Paralelní zpracování s limitem ---

async function processWithLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let index = 0;
  const total = items.length;

  async function worker() {
    while (index < total) {
      const currentIndex = index++;
      // currentIndex < total invariant; non-null assertion satisfies
      // tsconfig noUncheckedIndexedAccess.
      await fn(items[currentIndex]!, currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(limit, total) }, () => worker());
  await Promise.all(workers);
}

// --- Hlavní logika ---

async function main() {
  await loadDependencies();

  console.log(`\n📂 Vstup:  ${INPUT_DIR}`);
  console.log(`📂 Výstup: ${OUTPUT_DIR}`);
  console.log(`📐 Max šířka: ${MAX_WIDTH} px`);
  console.log(`🎨 JPEG kvalita: ${QUALITY}`);
  console.log(`⚡ Paralelně: ${PARALLEL} souborů`);
  if (DRY_RUN) console.log(`🔍 DRY RUN — nic se nezapíše`);
  if (FORCE) console.log(`🔄 FORCE — přepíše existující`);
  console.log('');

  // Načíst seznam souborů
  let files: string[];
  try {
    files = await readdir(INPUT_DIR);
  } catch (err) {
    console.error(`❌ Nelze číst vstupní složku: ${INPUT_DIR}`);
    process.exit(1);
  }

  const imageFiles = files.filter(isImageFile);
  console.log(`📸 Nalezeno ${imageFiles.length} obrázků z ${files.length} souborů celkem`);

  if (imageFiles.length === 0) {
    console.log('Žádné obrázky k zpracování.');
    return;
  }

  // Dry run — jen odhad
  if (DRY_RUN) {
    let totalInput = 0;
    for (const file of imageFiles) {
      const s = await stat(join(INPUT_DIR, file));
      totalInput += s.size;
    }

    // Odhad: HEIC 2 MB → JPEG 300 KB = ~85% redukce
    // JPEG 5 MB → JPEG 300 KB = ~94% redukce
    const estimatedOutput = totalInput * 0.15;
    console.log(`\n📊 Odhad:`);
    console.log(`   Vstup:  ${formatSize(totalInput)}`);
    console.log(`   Výstup: ~${formatSize(estimatedOutput)}`);
    console.log(`   Úspora: ~${formatSize(totalInput - estimatedOutput)}`);

    // Rozpad podle přípony
    const byExt = new Map<string, number>();
    for (const file of imageFiles) {
      const ext = extname(file).toLowerCase();
      byExt.set(ext, (byExt.get(ext) || 0) + 1);
    }
    console.log(`\n   Rozpad: ${[...byExt].map(([e, c]) => `${e} ${c}×`).join(', ')}`);
    return;
  }

  // Vytvořit výstupní složku
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Zpracovat soubory
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let totalInputSize = 0;
  let totalOutputSize = 0;
  const failures: Array<{ file: string; error: string }> = [];
  const startTime = Date.now();

  await processWithLimit(imageFiles, PARALLEL, async (file, idx) => {
    const inputPath  = join(INPUT_DIR, file);
    const outFile    = outputFilename(file);
    const outputPath = join(OUTPUT_DIR, outFile);

    try {
      const result = await convertFile(inputPath, outputPath);
      totalInputSize += result.inputSize;

      if (result.skipped) {
        skipped++;
      } else {
        totalOutputSize += result.outputSize;
        processed++;
      }
    } catch (err: any) {
      failed++;
      failures.push({ file, error: err.message });
      if (VERBOSE) {
        console.error(`  ✗ ${file}: ${err.message}`);
      }
    }

    // Progress bar (každých 100 souborů)
    const total = imageFiles.length;
    const done = idx + 1;
    if (done % 100 === 0 || done === total) {
      const pct = ((done / total) * 100).toFixed(0);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (done / ((Date.now() - startTime) / 1000)).toFixed(1);
      process.stdout.write(
        `\r  [${pct}%] ${done}/${total} — ${rate} souborů/s — ${elapsed}s`
      );
    }
  });

  console.log('\n');

  // Souhrn
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ Hotovo za ${elapsed} s`);
  console.log(`   Zpracováno: ${processed}`);
  console.log(`   Přeskočeno (už existují): ${skipped}`);
  console.log(`   Selhalo: ${failed}`);
  if (processed > 0) {
    const ratio = ((1 - totalOutputSize / totalInputSize) * 100).toFixed(0);
    console.log(`   Vstup:  ${formatSize(totalInputSize)}`);
    console.log(`   Výstup: ${formatSize(totalOutputSize)}`);
    console.log(`   Úspora: ${formatSize(totalInputSize - totalOutputSize)} (−${ratio}%)`);
  }

  // Výpis selhání
  if (failures.length > 0) {
    console.log(`\n⚠️  Selhání (${failures.length}):`);
    for (const f of failures.slice(0, 20)) {
      console.log(`   ${f.file}: ${f.error}`);
    }
    if (failures.length > 20) {
      console.log(`   ... a dalších ${failures.length - 20}`);
    }
  }

  console.log(`\n📤 Upload-ready soubory jsou v: ${OUTPUT_DIR}`);
  console.log(`   Nahrát na VPS:`);
  console.log(`   rsync -av --progress ${OUTPUT_DIR}/ app@ctyrlistkoteka.cz:/var/ctyrlistkoteka/data/finds/`);
}

main().catch(err => {
  console.error('Fatální chyba:', err);
  process.exit(1);
});
