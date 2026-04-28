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
 *   # Rekurzivní vstup (originály mají strukturu Rok/Měsíc), výstup zůstane
 *   # plochý (basename → output). Filtr přes seznam basename — zpracují se
 *   # jen ty soubory, jejichž basename je v daném souboru (jeden název na
 *   # řádek). Použití: vybrat z originálů jen ty, ke kterým existuje crop.
 *   npx tsx scripts/prepare-upload.ts \
 *     --input ~/Library/.../Originály \
 *     --output ~/ctyrlistkoteka-upload/finds \
 *     --recursive \
 *     --filter-from /tmp/crop-names.txt
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

import { readdir, stat, mkdir, access, readFile, writeFile, utimes } from 'node:fs/promises';
import { join, extname, basename, parse as parsePath, relative } from 'node:path';
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
    input:         { type: 'string', short: 'i' },
    output:        { type: 'string', short: 'o' },
    'max-width':   { type: 'string', default: '2000' },
    quality:       { type: 'string', default: '82' },
    'dry-run':     { type: 'boolean', default: false },
    'force':       { type: 'boolean', default: false },
    'parallel':    { type: 'string', default: '4' },
    'verbose':     { type: 'boolean', short: 'v', default: false },
    'recursive':   { type: 'boolean', short: 'r', default: false },
    'filter-from': { type: 'string' },
    'input-from':  { type: 'string' },
    'target-kb':   { type: 'string' },
    'min-quality': { type: 'string', default: '45' },
    'min-width':   { type: 'string', default: '1200' },
  },
  strict: true,
});

if (!args.input || !args.output) {
  console.error('Použití: npx tsx scripts/prepare-upload.ts --input <složka> --output <složka>');
  console.error('Volitelné: --max-width 2000 --quality 82 --dry-run --force --parallel 4 --verbose');
  console.error('           --recursive (procházej podsložky)');
  console.error('           --filter-from <soubor> (jeden basename na řádek; zpracovat jen tyto)');
  console.error('           --target-kb 450 --min-quality 45 --min-width 1200');
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
const RECURSIVE   = args.recursive!;
const FILTER_FROM = args['filter-from'];
const INPUT_FROM  = args['input-from'];
const TARGET_KB   = args['target-kb'] ? parseInt(args['target-kb'], 10) : 0;
const TARGET_BYTES = Number.isFinite(TARGET_KB) && TARGET_KB > 0 ? TARGET_KB * 1024 : 0;
const PIXEL_TARGET_BYTES = TARGET_BYTES ? Math.max(1, TARGET_BYTES - 32 * 1024) : 0;
const TARGET_TOLERANCE_BYTES = TARGET_BYTES ? Math.ceil(TARGET_BYTES * 1.05) : 0;
const MIN_QUALITY = parseInt(args['min-quality']!, 10);
const MIN_WIDTH   = parseInt(args['min-width']!, 10);

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

/**
 * Recursively (or shallowly) scan an input directory for image files.
 * Returns paths relative to `root` so callers can keep both the source
 * path (for IO) and the basename (for filter matching + flat output
 * naming). Hidden entries (`.`-prefixed) are skipped — covers `.DS_Store`,
 * iCloud's `.icloud` placeholders, etc.
 */
async function scanInput(root: string, recursive: boolean): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) await walk(full);
        continue;
      }
      if (entry.isFile() && isImageFile(entry.name)) {
        out.push(relative(root, full));
      }
    }
  }

  await walk(root);
  return out;
}

/**
 * Reads an --input-from list of relative paths (one per line). Useful
 * when Node.js's `readdir` disagrees with the on-disk reality — for
 * iCloud-synced folders we've seen `readdir` surface "ghost" entries
 * for files that were renamed locally but whose old name still exists
 * as a server-side stub. Bash's `find` walks the actual file table and
 * is authoritative; piping its output through this flag lets the
 * conversion stage operate on a known-good list.
 */
async function loadInputList(path: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err: any) {
    console.error(`❌ Nelze číst --input-from soubor: ${path}`);
    console.error(`   ${err.message ?? err}`);
    process.exit(1);
  }
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!isImageFile(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}

/**
 * Reads the --filter-from list. Each non-empty, non-comment line
 * contributes one basename (case-insensitive). Returns null when no
 * filter file was provided.
 */
async function loadFilter(path: string | undefined): Promise<Set<string> | null> {
  if (!path) return null;
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err: any) {
    console.error(`❌ Nelze číst --filter-from soubor: ${path}`);
    console.error(`   ${err.message ?? err}`);
    process.exit(1);
  }
  const set = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Filter může obsahovat plné cesty nebo basename — vždy bereme jen
    // basename, ať uživatel nemusí stripovat ručně.
    set.add(basename(trimmed).toLowerCase());
  }
  return set;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function shortCommandError(err: any): string {
  const parts = [
    err?.stderr,
    err?.stdout,
    err?.message,
    String(err),
  ].filter(Boolean);
  return String(parts[0] ?? 'neznámá chyba').split(/\r?\n/)[0]!.trim();
}

async function preserveFileTimes(
  outputPath: string,
  inputStat: { atime: Date; mtime: Date },
): Promise<void> {
  await utimes(outputPath, inputStat.atime, inputStat.mtime);
}

// --- Konverze jednoho souboru ---

type ConvertResult = {
  inputSize: number;
  outputSize: number;
  skipped: boolean;
  metadataSynced: boolean;
  quality: number;
  width: number | undefined;
};

type EncodedImage = {
  buffer: Buffer;
  quality: number;
  width: number | undefined;
};

async function convertFile(
  inputPath: string,
  outputPath: string,
): Promise<ConvertResult> {
  const inputStat = await stat(inputPath);
  const inputSize = inputStat.size;

  const outputAlreadyExists = await fileExists(outputPath);
  let existingTooLarge = false;
  if (!FORCE && outputAlreadyExists && TARGET_TOLERANCE_BYTES > 0) {
    const outputStat = await stat(outputPath);
    existingTooLarge = outputStat.size > TARGET_TOLERANCE_BYTES;
  }

  // Pokud output existuje, není --force a není větší než cílový limit,
  // nepřevádět znovu. Metadata ale přepiš z originálu i u starších
  // upload-ready souborů, které mohly vzniknout v době, kdy exiftool
  // nebyl z GUI dostupný.
  if (!FORCE && outputAlreadyExists && !existingTooLarge) {
    await copyMetadataFromOriginal(inputPath, outputPath);
    await preserveFileTimes(outputPath, inputStat);
    const outputStat = await stat(outputPath);

    if (VERBOSE) {
      console.log(`  ↺ ${basename(inputPath)} metadata obnovena, konverze přeskočena`);
    }

    return {
      inputSize,
      outputSize: outputStat.size,
      skipped: true,
      metadataSynced: true,
      quality: QUALITY,
      width: undefined,
    };
  }

  if (VERBOSE && existingTooLarge) {
    console.log(
      `  ↻ ${basename(inputPath)} existuje, ale je větší než ${TARGET_KB} KB — zmenšuji znovu`
    );
  }

  const ext = extname(inputPath).toLowerCase();
  let inputBuffer = await readFile(inputPath);

  // HEIC → JPEG buffer (heic-convert)
  if (ext === '.heic' || ext === '.heif') {
    const converted = await (heicConvert as any)({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: 1, // max kvalita, sharp ji pak sníží
    });
    inputBuffer = Buffer.from(converted);
  }

  // sharp: resize + JPEG komprese. Metadata po zápisu přepíše exiftool
  // z originálu, protože to je spolehlivější pro HEIC i JPEG vstupy.
  const image = (sharp as any)(inputBuffer);

  const metadata = await image.metadata();
  const needsResize = metadata.width && metadata.width > MAX_WIDTH;

  // .rotate() aplikuje EXIF orientaci do pixelů (mobily často ukládají
  //   fotky otočené jen v EXIF, ne v pixelech).
  const targetWidth = metadata.width ? Math.min(metadata.width, MAX_WIDTH) : undefined;
  const encodeWidth = TARGET_BYTES ? targetWidth : (needsResize ? targetWidth : undefined);
  const encoded = await encodeJpeg(inputBuffer, encodeWidth);
  const outputBuffer = encoded.buffer;

  await writeFile(outputPath, outputBuffer);

  // Obnov metadata z originálu pro všechny formáty. Orientation se
  // resetuje na 1, protože sharp.rotate() už pixely natočil; jinak by
  // viewer rotaci aplikoval podruhé.
  await copyMetadataFromOriginal(inputPath, outputPath);

  // Zachovat datum souboru z originálu (mtime + atime). Musí být po
  // exiftool kroku, protože ten by jinak mtime přepsal.
  await preserveFileTimes(outputPath, inputStat);

  const outputSize = (await stat(outputPath)).size;

  if (VERBOSE) {
    const ratio = ((1 - outputSize / inputSize) * 100).toFixed(0);
    const dims = metadata.width && metadata.height
      ? `${metadata.width}×${metadata.height}`
      : '?';
    const newWidth = encoded.width ?? metadata.width;
    const qualitySuffix = encoded.quality !== QUALITY ? ` q${encoded.quality}` : '';
    console.log(
      `  ✓ ${basename(inputPath)} ${dims}→${newWidth}px ` +
      `${formatSize(inputSize)}→${formatSize(outputSize)} (−${ratio}%)${qualitySuffix}`
    );
  }

  return {
    inputSize,
    outputSize,
    skipped: false,
    metadataSynced: true,
    quality: encoded.quality,
    width: encoded.width,
  };
}

async function encodeJpeg(
  inputBuffer: Buffer,
  initialWidth: number | undefined,
): Promise<EncodedImage> {
  const minQuality = Math.max(1, Math.min(QUALITY, MIN_QUALITY));
  const minWidth = Math.max(1, Math.min(initialWidth ?? MAX_WIDTH, MIN_WIDTH));
  const targetMaxQuality = TARGET_BYTES ? Math.min(QUALITY, 70) : QUALITY;

  async function encodeAt(width: number | undefined, quality: number): Promise<EncodedImage> {
    let pipeline = (sharp as any)(inputBuffer).rotate();
    if (width) {
      pipeline = pipeline.resize({
        width,
        withoutEnlargement: true,
      });
    }

    const buffer = await pipeline
      .withMetadata()    // zachovej co sharp ještě má (JPEG vstupy)
      .jpeg({
        quality,
        mozjpeg: true,   // lepší komprese
      })
      .toBuffer();

    return { buffer, quality, width };
  }

  if (!PIXEL_TARGET_BYTES) {
    return encodeAt(initialWidth, QUALITY);
  }

  let width = initialWidth;
  let best = await encodeAt(width, targetMaxQuality);
  if (best.buffer.length <= PIXEL_TARGET_BYTES) {
    return best;
  }

  if (width) {
    const scale = Math.sqrt(PIXEL_TARGET_BYTES / best.buffer.length) * 0.98;
    width = Math.max(minWidth, Math.min(width - 1, Math.floor(width * scale)));
    best = await encodeAt(width, targetMaxQuality);
    if (best.buffer.length <= PIXEL_TARGET_BYTES) {
      return best;
    }
  }

  for (let quality = targetMaxQuality - 4; quality >= minQuality; quality -= 4) {
    const encoded = await encodeAt(width, quality);
    best = encoded;
    if (encoded.buffer.length <= PIXEL_TARGET_BYTES) {
      return encoded;
    }
  }

  if (width && width > minWidth) {
    const scale = Math.sqrt(PIXEL_TARGET_BYTES / best.buffer.length) * 0.98;
    const smallerWidth = Math.max(minWidth, Math.min(width - 1, Math.floor(width * scale)));
    if (smallerWidth < width) {
      width = smallerWidth;
      best = await encodeAt(width, targetMaxQuality);
      if (best.buffer.length <= PIXEL_TARGET_BYTES) {
        return best;
      }
      for (let quality = targetMaxQuality - 4; quality >= minQuality; quality -= 4) {
        const encoded = await encodeAt(width, quality);
        best = encoded;
        if (encoded.buffer.length <= PIXEL_TARGET_BYTES) {
          return encoded;
        }
      }
    }
  }

  return best;
}

// --- EXIF zotavení z originálu přes exiftool ---

/**
 * Kopíruje metadata z originálu do už-vyrobeného JPEG. Volá se po sharp
 * pipeline pro každý vstupní formát i pro existující upload-ready soubory.
 * Orientation je vynulovaná (1 = bez rotace), protože sharp.rotate() už
 * pixely otočil podle původní orientace.
 *
 * Vyžaduje `exiftool` v PATH (na macOS: `brew install exiftool`).
 * Při selhání konverzi zastaví — upload-ready soubor bez GPS/datumu by
 * vypadal úspěšně, ale pro webová data je to horší než jasná chyba.
 */
async function copyMetadataFromOriginal(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  try {
    await execFileAsync('exiftool', [
      '-overwrite_original',
      '-m',                           // tolerantní k drobným chybám
      '-TagsFromFile', sourcePath,
      '-EXIF:All>EXIF:All',
      '-GPS:All>GPS:All',
      '-XMP:All>XMP:All',
      '-IPTC:All>IPTC:All',
      '-ICC_Profile>ICC_Profile',
      '-ThumbnailImage=',
      '-PreviewImage=',
      '-JpgFromRaw=',
      '-OtherImage=',
      '-Orientation#=1',              // reset; pixely jsou už správně
      targetPath,
    ], { maxBuffer: 8 * 1024 * 1024 });
  } catch (err: any) {
    throw new Error(
      `Nelze zachovat metadata pro ${basename(targetPath)}: ` +
      `${shortCommandError(err)}. Ověř, že je exiftool nainstalovaný a dostupný v PATH.`
    );
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

  console.log(`\n📂 Vstup:  ${INPUT_DIR}${RECURSIVE ? ' (rekurzivně)' : ''}`);
  console.log(`📂 Výstup: ${OUTPUT_DIR}`);
  console.log(`📐 Max šířka: ${MAX_WIDTH} px`);
  console.log(`🎨 JPEG kvalita: ${QUALITY}`);
  if (TARGET_BYTES) {
    console.log(`🎯 Cílová velikost: ${TARGET_KB} KB (min. ${MIN_WIDTH}px, q${MIN_QUALITY})`);
  }
  console.log(`⚡ Paralelně: ${PARALLEL} souborů`);
  if (INPUT_FROM) console.log(`📜 Seznam vstupů: ${INPUT_FROM}`);
  if (FILTER_FROM) console.log(`🎯 Filtr: ${FILTER_FROM}`);
  if (DRY_RUN) console.log(`🔍 DRY RUN — nic se nezapíše`);
  if (FORCE) console.log(`🔄 FORCE — přepíše existující`);
  console.log('');

  // Načíst seznam souborů. --input-from explicitně bere seznam z disku
  // (typicky `find` výpis), čímž se vyhneme node.js readdir, který na
  // iCloud složkách občas surfaces phantom entries pro lokálně
  // přejmenované soubory.
  let relPaths: string[];
  try {
    relPaths = INPUT_FROM
      ? await loadInputList(INPUT_FROM)
      : await scanInput(INPUT_DIR, RECURSIVE);
  } catch (err) {
    console.error(`❌ Nelze získat seznam souborů.`);
    console.error(`   ${(err as Error).message}`);
    process.exit(1);
  }

  // Pokud je filter, vyfiltrovat na basename. Také ohlásit, kolik položek
  // ve filtru nemá v inputu match — typicky to znamená, že crop má jiný
  // název než originál a uživatel to chce vědět hned, ne až na konci.
  const filter = await loadFilter(FILTER_FROM);
  let imageFiles: string[];
  if (filter) {
    imageFiles = relPaths.filter((p) => filter.has(basename(p).toLowerCase()));
    const inputBasenames = new Set(
      relPaths.map((p) => basename(p).toLowerCase()),
    );
    const missing = [...filter].filter((b) => !inputBasenames.has(b));
    console.log(
      `📸 Nalezeno ${imageFiles.length} obrázků (z ${relPaths.length} ve vstupu, ` +
        `${filter.size} ve filtru). Filtr bez match ve vstupu: ${missing.length}.`,
    );
    if (missing.length > 0 && missing.length <= 10) {
      console.log(`   Chybí: ${missing.join(', ')}`);
    } else if (missing.length > 10) {
      console.log(`   Prvních 10 chybějících: ${missing.slice(0, 10).join(', ')}`);
    }
  } else {
    imageFiles = relPaths;
    console.log(`📸 Nalezeno ${imageFiles.length} obrázků`);
  }

  // Detekce kolizí basename — výstup je vždy plochý, takže dva vstupní
  // soubory se stejným basename by se přepsaly. V naší doméně by to
  // nemělo nastat (ověřeno na lokálu), ale skript to musí ohlásit.
  const seen = new Map<string, string>();
  const collisions: Array<{ a: string; b: string }> = [];
  for (const p of imageFiles) {
    const key = basename(p).toLowerCase();
    const prev = seen.get(key);
    if (prev) collisions.push({ a: prev, b: p });
    else seen.set(key, p);
  }
  if (collisions.length > 0) {
    console.warn(
      `\n⚠️  ${collisions.length} kolizí basename — pouze první výskyt se zpracuje:`,
    );
    for (const c of collisions.slice(0, 5)) {
      console.warn(`   "${c.a}"  vs  "${c.b}"`);
    }
    // Reduce imageFiles to unique-by-basename, keep insertion order.
    imageFiles = [...seen.values()];
  }

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
  let metadataSynced = 0;
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
      if (result.metadataSynced) {
        metadataSynced++;
      }
    } catch (err: any) {
      failed++;
      failures.push({ file, error: err.message });
      if (VERBOSE) {
        console.error(`  ✗ ${file}: ${err.message}`);
      }
    }

    // Progress bar (ve verbose režimu každý soubor, jinak každých 100)
    const total = imageFiles.length;
    const done = idx + 1;
    const progressEvery = VERBOSE ? 1 : 100;
    if (done % progressEvery === 0 || done === total) {
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
  console.log(`   Metadata zachována/opravena: ${metadataSynced}`);
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
