/* eslint-disable @typescript-eslint/no-require-imports */
import { createWriteStream, promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { Entry, ZipFile } from "yauzl";
import { prisma } from "@/lib/db";
import { ensureDir } from "./atomic";
import { ADMIN_ROOTS, safeJoin } from "./paths";
import {
  parseMapPackageManifest,
  entryNumber,
  type MapPackageManifest,
  type MapPackageEntry,
} from "@/lib/mapPackage";
import { readZipEntry } from "./importZip";

/**
 * Iterate a zip decoding entry names as **UTF-8 ourselves**, not via yauzl's
 * default. yauzl only UTF-8-decodes when the entry sets the language-encoding
 * (bit 11) flag; macOS `ditto`/`zip` often write UTF-8 bytes WITHOUT that flag,
 * so yauzl falls back to CP437 and diacritics come out as mojibake
 * ("Ratibo┼Ö"). A v2 package is nothing but diacritics in its paths, and a
 * wrong name here would stage files sync can't find — so we read the raw
 * filename buffer and decode UTF-8 + NFC unconditionally. See docs/gotchas.md.
 *
 * v1 importZip.iterateZip is left as-is; this is v2-only.
 */
async function iterateZipUtf8(
  zipPath: string,
  onEntry: (
    zipPath: string,
    zip: ZipFile,
    raw: Entry,
  ) => Promise<void>,
): Promise<void> {
  const yauzl = require("yauzl") as typeof import("yauzl");
  await new Promise<void>((resolve, reject) => {
    yauzl.open(
      zipPath,
      { lazyEntries: true, decodeStrings: false },
      (err, zip) => {
        if (err || !zip) {
          reject(err ?? new Error("Nelze otevřít ZIP."));
          return;
        }
        const fail = (e: unknown) => {
          zip.close();
          reject(e instanceof Error ? e : new Error(String(e)));
        };
        zip.on("entry", (raw: Entry) => {
          // decodeStrings:false → raw.fileName is a Buffer.
          const name = (raw.fileName as unknown as Buffer)
            .toString("utf8")
            .normalize("NFC");
          if (name.endsWith("/") || name.startsWith("__MACOSX/") || path.basename(name) === ".DS_Store") {
            zip.readEntry();
            return;
          }
          onEntry(name, zip, raw).then(() => zip.readEntry(), fail);
        });
        zip.on("end", () => resolve());
        zip.on("error", reject);
        zip.readEntry();
      },
    );
  });
}

/**
 * Import path for a **v2 map package** ZIP (`manifest.json` + `Nosné mapy/…`
 * + `Rendered mapy/…`), the repeatable web-update flow for location maps.
 *
 * Deliberately separate from importZip.ts (the v1 flat finds/crops/maps/meta
 * package): a v2 package is a nested tree keyed by the manifest, so its
 * analyze/commit differ enough that mixing them would muddy both. v1 stays
 * untouched. The route picks this path when the ZIP has a manifest.json.
 *
 * Commit only STAGES files into data/maps/ (manifest + the Nosné/Rendered
 * trees); it writes NO database — that's the later `sync` run, which reads
 * data/maps/manifest.json via phaseMapsV2. Staging is idempotent: a map is
 * addressed by its číslo, and re-importing overwrites the same paths.
 */

/** Only these top-level trees (plus manifest.json) are staged from the zip. */
const NOSNE = "Nosné mapy";
const RENDERED = "Rendered mapy";
const MANIFEST_NAME = "manifest.json";

export interface MapPackageImportEntry {
  cislo: string;
  idLokace: string;
  mesto: string;
  popis: string;
  action: "add" | "replace";
}

export interface MapPackageImportPlan {
  isV2Package: true;
  createdAt: string | null;
  total: number;
  add: number;
  replace: number;
  entries: MapPackageImportEntry[];
  /** True when the zip carries a Rendered variant alongside the Nosná. */
  hasRendered: boolean;
  warnings: string[];
}

/**
 * Reads and validates the manifest.json out of a package zip WITHOUT
 * extracting anything. Returns null when the zip has no manifest at its root
 * (→ not a v2 package; the caller falls back to the v1 importer).
 */
export async function readManifestFromZip(
  zipPath: string,
): Promise<
  | { ok: true; manifest: MapPackageManifest }
  | { ok: false; error: string }
  | null
> {
  let buf: Buffer | null = null;
  await iterateZipUtf8(zipPath, async (zp, zip, raw) => {
    // Root-level manifest.json only (ignore any nested stray copy).
    if (zp === MANIFEST_NAME) buf = await readZipEntry(zip, raw);
  });
  if (buf === null) return null;
  const parsed = parseMapPackageManifest((buf as Buffer).toString("utf8"));
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, manifest: parsed.value };
}

/** True when this zip is a v2 map package (has a root manifest.json). */
export async function isMapPackageZip(zipPath: string): Promise<boolean> {
  const r = await readManifestFromZip(zipPath);
  return r !== null;
}

/**
 * Read-only analysis: reads the manifest, marks each map add vs replace
 * against the existing location_maps rows, and checks the referenced Nosná
 * files are actually in the zip. Writes nothing.
 */
export async function analyzeMapPackageZip(
  zipPath: string,
): Promise<MapPackageImportPlan | { error: string }> {
  const r = await readManifestFromZip(zipPath);
  if (r === null) return { error: "ZIP neobsahuje manifest.json (není to v2 balíček map)." };
  if (!r.ok) return { error: `Neplatný manifest.json: ${r.error}` };
  const manifest = r.manifest;

  // Which files does the zip actually contain, and does it have a Rendered tree?
  const zipFiles = new Set<string>();
  let hasRendered = false;
  await iterateZipUtf8(zipPath, async (zp) => {
    zipFiles.add(zp);
    if (zp.startsWith(`${RENDERED}/`)) hasRendered = true;
  });

  const existing = new Set(
    (await prisma.locationMap.findMany({ select: { id: true } })).map((m) => m.id),
  );

  const entries: MapPackageImportEntry[] = [];
  const warnings: string[] = [];
  for (const m of manifest.mapy) {
    const nosna = m.soubory[NOSNE];
    if (!zipFiles.has(nosna)) {
      warnings.push(`Mapa #${m.cislo}: soubor "${nosna}" chybí v ZIP.`);
      continue;
    }
    entries.push({
      cislo: m.cislo,
      idLokace: m.id_lokace,
      mesto: m.mesto,
      popis: m.popis,
      action: existing.has(entryNumber(m)) ? "replace" : "add",
    });
  }
  entries.sort((a, b) => a.cislo.localeCompare(b.cislo));

  return {
    isV2Package: true,
    createdAt: manifest.vytvoreno ?? null,
    total: entries.length,
    add: entries.filter((e) => e.action === "add").length,
    replace: entries.filter((e) => e.action === "replace").length,
    entries,
    hasRendered,
    warnings,
  };
}

// ─── Commit (staging only, no DB) ────────────────────────────────────────────

export interface MapPackageImportSummary {
  staged: number;
  manifestStaged: boolean;
  errors: string[];
}

/** Streams one zip entry to destPath atomically (tmp in same dir → rename). */
async function stageEntry(
  zip: ZipFile,
  raw: Entry,
  destPath: string,
): Promise<void> {
  await ensureDir(path.dirname(destPath));
  const tmp = `${destPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.openReadStream(raw, (err, stream) => {
        if (err || !stream) {
          reject(err ?? new Error("Nelze číst položku ZIP."));
          return;
        }
        const ws = createWriteStream(tmp);
        stream.on("error", reject);
        ws.on("error", reject);
        ws.on("finish", () => resolve());
        stream.pipe(ws);
      });
    });
    await fs.rename(tmp, destPath);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/** A zip path we stage: manifest.json, or a file under the Nosné/Rendered trees. */
function shouldStage(zipPath: string): boolean {
  return (
    zipPath === MANIFEST_NAME ||
    zipPath.startsWith(`${NOSNE}/`) ||
    zipPath.startsWith(`${RENDERED}/`)
  );
}

/**
 * Stages the package into data/maps/ (manifest + the Nosné/Rendered trees,
 * subfolder structure preserved) so a subsequent `sync` picks it up via
 * phaseMapsV2. safeJoin keeps every write inside data/maps/ (rejects
 * traversal/absolute paths); the nested paths themselves are allowed.
 *
 * No .trash dance and no DB writes: v2 maps are addressed by číslo and the
 * manifest is the batch to sync, so overwriting the same relative paths is
 * the intended idempotent behaviour.
 */
export async function commitMapPackage(
  zipPath: string,
): Promise<MapPackageImportSummary> {
  const summary: MapPackageImportSummary = {
    staged: 0,
    manifestStaged: false,
    errors: [],
  };

  await iterateZipUtf8(zipPath, async (zp, zip, raw) => {
    if (!shouldStage(zp)) return;
    try {
      // safeJoin validates the (possibly nested) path stays within data/maps/.
      const dest = safeJoin("locationMaps", zp);
      await stageEntry(zip, raw, dest);
      if (zp === MANIFEST_NAME) summary.manifestStaged = true;
      else summary.staged++;
    } catch (err) {
      summary.errors.push(`${zp}: ${(err as Error).message}`);
    }
  });

  if (!summary.manifestStaged) {
    summary.errors.push("manifest.json nebyl nalezen — balíček nebyl uložen ke zpracování.");
  }
  return summary;
}
