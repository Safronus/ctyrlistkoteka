/* eslint-disable @typescript-eslint/no-require-imports */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Entry, ZipFile } from "yauzl";
import { ADMIN_ROOTS } from "./paths";
import {
  LOKACE_STAVY_POZNAMKY_FILENAME,
  lokaceStavyPoznamkyMergeInputSchema,
} from "./jsonSchema";

/**
 * Streaming reader + read-only analyzer for a "web package" ZIP. yauzl opens
 * the archive on disk and yields entries lazily, so a hundreds-of-MB package
 * is never loaded into memory. Categories at the zip root: finds/ crops/
 * maps/ meta/LokaceStavyPoznamky.json (see the import spec).
 */

export type ImportCategory = "finds" | "crops" | "maps" | "meta" | "other";

export interface ImportEntry {
  /** Full path inside the zip (NFC-normalized). */
  zipPath: string;
  /** basename, NFC-normalized. */
  name: string;
  category: ImportCategory;
  /** find id (finds/crops) — first `+` token. */
  findId: number | null;
  /** MAP_ID (maps) — last `+` segment, 5 digits. */
  mapId: string | null;
  uncompressedSize: number;
}

export interface ImportPlan {
  finds: { total: number; add: number; replace: number };
  crops: { total: number; add: number; replace: number };
  maps: { total: number; add: number; replace: number };
  /** find ids present in only one of finds/ or crops/. */
  incompletePairs: Array<{ findId: number; has: "orig" | "crop" }>;
  /** zip entry names that couldn't be parsed to an id / map id. */
  invalidNames: string[];
  lsp: {
    present: boolean;
    counts: { lokace: number; stavy: number; poznamky: number; anon: number };
    /** find ids whose incoming poznámka text differs from the current file —
     *  the whole-file merge ABORTS on these, so surface them before commit. */
    poznamkyConflicts: number[];
  };
  warnings: string[];
}

const lspPath = path.join(ADMIN_ROOTS.meta, LOKACE_STAVY_POZNAMKY_FILENAME);

/** find id = first `+` token (full form `<ID>+…`) or the whole stem for the
 *  short crop form `<ID>.jpg`. Positive integer, else null. */
export function findIdOf(name: string): number | null {
  const first = (name.split("+")[0] ?? "").replace(/\.[^.]+$/, "");
  if (!/^\d+$/.test(first)) return null;
  const n = Number(first);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** MAP_ID = last `+` segment of the stem, exactly 5 digits. */
export function mapIdOf(name: string): string | null {
  const stem = name.replace(/\.[^.]+$/, "");
  const segs = stem.split("+");
  const last = segs.at(-1);
  return last && /^\d{5}$/.test(last) ? last : null;
}

function categorize(zipPath: string): ImportCategory {
  const top = zipPath.split("/")[0];
  if (top === "finds") return "finds";
  if (top === "crops") return "crops";
  if (top === "maps") return "maps";
  if (top === "meta") return "meta";
  return "other";
}

/** Skip directory entries + macOS archive cruft. */
function isSkippable(zipPath: string): boolean {
  return (
    zipPath.endsWith("/") ||
    zipPath.startsWith("__MACOSX/") ||
    path.basename(zipPath) === ".DS_Store"
  );
}

/** Opens the zip and calls `onEntry` for each non-skippable file entry, in
 *  order, awaiting each callback (backpressure). Streaming — no full load. */
export async function iterateZip(
  zipPath: string,
  onEntry: (entry: ImportEntry, zip: ZipFile, raw: Entry) => Promise<void>,
): Promise<void> {
  const yauzl = require("yauzl") as typeof import("yauzl");
  await new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(err ?? new Error("Nelze otevřít ZIP."));
        return;
      }
      const fail = (e: unknown) => {
        zip.close();
        reject(e instanceof Error ? e : new Error(String(e)));
      };
      zip.on("entry", (raw: Entry) => {
        const zp = raw.fileName.normalize("NFC");
        if (isSkippable(zp)) {
          zip.readEntry();
          return;
        }
        const name = path.basename(zp).normalize("NFC");
        const category = categorize(zp);
        const entry: ImportEntry = {
          zipPath: zp,
          name,
          category,
          findId:
            category === "finds" || category === "crops" ? findIdOf(name) : null,
          mapId: category === "maps" ? mapIdOf(name) : null,
          uncompressedSize: raw.uncompressedSize,
        };
        onEntry(entry, zip, raw).then(() => zip.readEntry(), fail);
      });
      zip.on("end", () => resolve());
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

/** Buffers a single zip entry's bytes. Use only for small entries (LSP JSON). */
export function readZipEntry(zip: ZipFile, raw: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(raw, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error("Nelze číst položku ZIP."));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  });
}

async function existingFindIds(root: string): Promise<Set<number>> {
  const out = new Set<number>();
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return out;
    throw e;
  }
  for (const n of names) {
    const id = findIdOf(n.normalize("NFC"));
    if (id !== null) out.add(id);
  }
  return out;
}

async function existingMapIds(root: string): Promise<Set<string>> {
  const out = new Set<string>();
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return out;
    throw e;
  }
  for (const n of names) {
    const id = mapIdOf(n.normalize("NFC"));
    if (id !== null) out.add(id);
  }
  return out;
}

async function readCurrentPoznamky(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(lspPath, "utf8");
    const parsed = JSON.parse(raw) as { poznamky?: Record<string, string> };
    return parsed.poznamky && typeof parsed.poznamky === "object"
      ? parsed.poznamky
      : {};
  } catch {
    return {};
  }
}

/** Read-only pass: categorize + count new vs replace, incomplete pairs,
 *  invalid names, and the LSP merge preview. Writes nothing. */
export async function analyzeImportZip(zipPath: string): Promise<ImportPlan> {
  const [existFinds, existCrops, existMaps, currentPoznamky] = await Promise.all([
    existingFindIds(ADMIN_ROOTS.findOriginals),
    existingFindIds(ADMIN_ROOTS.findCrops),
    existingMapIds(ADMIN_ROOTS.locationMaps),
    readCurrentPoznamky(),
  ]);

  const finds = { total: 0, add: 0, replace: 0 };
  const crops = { total: 0, add: 0, replace: 0 };
  const maps = { total: 0, add: 0, replace: 0 };
  const findIdsInZip = new Set<number>();
  const cropIdsInZip = new Set<number>();
  const invalidNames: string[] = [];
  const warnings: string[] = [];
  let lspBuf: Buffer | null = null;

  await iterateZip(zipPath, async (entry, zip, raw) => {
    switch (entry.category) {
      case "finds":
        finds.total++;
        if (entry.findId === null) invalidNames.push(entry.zipPath);
        else {
          findIdsInZip.add(entry.findId);
          if (existFinds.has(entry.findId)) finds.replace++;
          else finds.add++;
        }
        break;
      case "crops":
        crops.total++;
        if (entry.findId === null) invalidNames.push(entry.zipPath);
        else {
          cropIdsInZip.add(entry.findId);
          if (existCrops.has(entry.findId)) crops.replace++;
          else crops.add++;
        }
        break;
      case "maps":
        maps.total++;
        if (entry.mapId === null) invalidNames.push(entry.zipPath);
        else if (existMaps.has(entry.mapId)) maps.replace++;
        else maps.add++;
        break;
      case "meta":
        if (entry.name === LOKACE_STAVY_POZNAMKY_FILENAME) {
          lspBuf = await readZipEntry(zip, raw);
        }
        break;
      case "other":
        // Ignore stray files at the zip root.
        break;
    }
  });

  // Incomplete pairs — a find with only an original or only a crop.
  const incompletePairs: Array<{ findId: number; has: "orig" | "crop" }> = [];
  for (const id of findIdsInZip)
    if (!cropIdsInZip.has(id)) incompletePairs.push({ findId: id, has: "orig" });
  for (const id of cropIdsInZip)
    if (!findIdsInZip.has(id)) incompletePairs.push({ findId: id, has: "crop" });
  incompletePairs.sort((a, b) => a.findId - b.findId);

  // LSP preview.
  const lsp: ImportPlan["lsp"] = {
    present: lspBuf !== null,
    counts: { lokace: 0, stavy: 0, poznamky: 0, anon: 0 },
    poznamkyConflicts: [],
  };
  if (lspBuf !== null) {
    try {
      const parsed = lokaceStavyPoznamkyMergeInputSchema.parse(
        JSON.parse((lspBuf as Buffer).toString("utf8")),
      );
      lsp.counts = {
        lokace: Object.keys(parsed.lokace ?? {}).length,
        stavy: Object.keys(parsed.stavy ?? {}).length,
        poznamky: Object.keys(parsed.poznamky ?? {}).length,
        anon: (parsed.anonymizace?.ANONYMIZOVANE ?? []).length,
      };
      // Whole-file merge aborts if an incoming poznámka key already exists
      // with a different text — flag those now so the operator isn't
      // surprised at commit.
      for (const [k, v] of Object.entries(parsed.poznamky ?? {})) {
        const cur = currentPoznamky[k];
        if (cur !== undefined && cur !== v) {
          const id = Number(k);
          if (Number.isInteger(id)) lsp.poznamkyConflicts.push(id);
        }
      }
      lsp.poznamkyConflicts.sort((a, b) => a - b);
    } catch (err) {
      warnings.push(
        `meta/${LOKACE_STAVY_POZNAMKY_FILENAME} je nevalidní: ${(err as Error).message}`,
      );
      lsp.present = false;
    }
  }

  if (finds.total === 0 && crops.total === 0 && maps.total === 0 && !lsp.present)
    warnings.push("Balíček nevypadá jako balíček pro web — nic k importu.");

  return { finds, crops, maps, incompletePairs, invalidNames, lsp, warnings };
}
