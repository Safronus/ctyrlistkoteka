import { promises as fs } from "node:fs";
import path from "node:path";
import { ImageType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { atomicWrite, ensureDir, trashTimestamp } from "@/lib/admin/atomic";
import { formatJsonCompactArrays } from "@/lib/admin/jsonFormat";
import {
  LOKACE_STAVY_POZNAMKY_FILENAME,
  lokaceStavyPoznamkySchema,
} from "@/lib/admin/jsonSchema";
import { ADMIN_ROOTS, safeBaseName, safeJoin } from "@/lib/admin/paths";
import { resolveDiskPath } from "@/lib/admin/scopes";
import { parseFindFilename } from "@/lib/parseFilename";
import { compactToRanges, parseRanges } from "@/lib/parseRanges";

/** ANON flag lives in segment[4] of the find filename: NE = public,
 *  ANO = anonymised. */
const ANON_SEGMENT_INDEX = 4;
const ANON_NO = "NE";
const ANON_YES = "ANO";

const META_TARGET_PATH = path.join(
  ADMIN_ROOTS.meta,
  LOKACE_STAVY_POZNAMKY_FILENAME,
);

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export interface FindRenameResult {
  filename: string;
  renamed: boolean;
  newFilename?: string;
  cropRenamed?: boolean;
  /** Set when nothing was renamed (already in the target state / no file
   *  on disk). Distinguishes a harmless no-op from a real error. */
  skipped?: string;
  error?: string;
}

/**
 * Flip pole 5 (segment[4]) of a single find-photo filename between NE and
 * ANO, renaming both the original (`data/finds/`) and its same-named crop
 * (`data/crops/`) on disk. Mirrors the file-rename half of the single-find
 * admin action (`setFindAnonymized`) so the map cascade + the `/admin/checks`
 * fix share one implementation. No auth / JSON / audit — callers batch those.
 * Idempotent: a filename already in the requested state is a skip, not an
 * error, so bulk callers can pass the whole location without pre-filtering.
 */
export async function renameFindPhotoAnon(
  rawName: string,
  anonymize: boolean,
): Promise<FindRenameResult> {
  let baseName: string;
  try {
    baseName = safeBaseName(rawName);
  } catch (err) {
    return { filename: rawName, renamed: false, error: (err as Error).message };
  }

  const resolved = await resolveDiskPath("findOriginals", baseName);
  if (!resolved) {
    return { filename: baseName, renamed: false, skipped: "original-missing" };
  }

  const parsed = parseFindFilename(resolved.name);
  if (!parsed.ok) {
    return {
      filename: resolved.name,
      renamed: false,
      error: `Název nelze rozparsovat: ${parsed.error}`,
    };
  }
  if (parsed.value.isAnonymized === anonymize) {
    return {
      filename: resolved.name,
      renamed: false,
      skipped: "already-in-state",
    };
  }

  const dot = resolved.name.lastIndexOf(".");
  if (dot === -1) {
    return {
      filename: resolved.name,
      renamed: false,
      error: "Název nemá příponu.",
    };
  }
  const stem = resolved.name.slice(0, dot);
  const ext = resolved.name.slice(dot);
  const segments = stem.split("+");
  if (segments.length < 6) {
    return {
      filename: resolved.name,
      renamed: false,
      error: `Očekáváno alespoň 6 segmentů, je ${segments.length}.`,
    };
  }

  segments[ANON_SEGMENT_INDEX] = anonymize ? ANON_YES : ANON_NO;
  const newName = segments.join("+") + ext;
  if (newName === resolved.name) {
    return { filename: resolved.name, renamed: false, skipped: "no-change" };
  }

  let newAbs: string;
  try {
    newAbs = safeJoin("findOriginals", newName);
  } catch (err) {
    return {
      filename: resolved.name,
      renamed: false,
      error: (err as Error).message,
    };
  }
  if (await fileExists(newAbs)) {
    return {
      filename: resolved.name,
      renamed: false,
      error: `Cíl "${newName}" už existuje v finds/.`,
    };
  }

  const cropResolved = await resolveDiskPath("findCrops", baseName);
  let cropNewAbs: string | null = null;
  if (cropResolved) {
    try {
      cropNewAbs = safeJoin("findCrops", newName);
    } catch (err) {
      return {
        filename: resolved.name,
        renamed: false,
        error: `Crop rename plan selhal: ${(err as Error).message}`,
      };
    }
    if (await fileExists(cropNewAbs)) {
      return {
        filename: resolved.name,
        renamed: false,
        error: `Cíl crops/"${newName}" už existuje.`,
      };
    }
  }

  await fs.rename(resolved.absolutePath, newAbs);

  let cropRenamed = false;
  if (cropResolved && cropNewAbs) {
    try {
      await fs.rename(cropResolved.absolutePath, cropNewAbs);
      cropRenamed = true;
    } catch (err) {
      // Original already renamed — a failed crop rename is logged but not
      // fatal (the crop keeps the old name; a re-run reconciles it).
      console.error(
        "[admin/findAnonymize] crop rename failed after original rename",
        { from: cropResolved.absolutePath, to: cropNewAbs, error: err },
      );
    }
  }

  return {
    filename: resolved.name,
    renamed: true,
    newFilename: newName,
    cropRenamed,
  };
}

/**
 * Add / remove find IDs in `anonymizace.ANONYMIZOVANE` in a single atomic
 * write (snapshotting the current file into `.trash` first). Returns the
 * IDs that actually changed. Re-emitted via parseRanges → compactToRanges
 * so the array stays sorted + range-merged.
 */
export async function applyAnonJson(
  addIds: readonly number[],
  removeIds: readonly number[],
): Promise<{ added: number[]; removed: number[]; skipped?: string }> {
  let raw: string;
  try {
    raw = await fs.readFile(META_TARGET_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { added: [], removed: [], skipped: "json-missing" };
    }
    throw err;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { added: [], removed: [], skipped: "json-unparseable" };
  }
  const result = lokaceStavyPoznamkySchema.safeParse(parsedJson);
  if (!result.success) return { added: [], removed: [], skipped: "json-invalid" };
  const data = result.data;

  const set = new Set(parseRanges(data.anonymizace.ANONYMIZOVANE));
  const added: number[] = [];
  const removed: number[] = [];
  for (const id of addIds) {
    if (!set.has(id)) {
      set.add(id);
      added.push(id);
    }
  }
  for (const id of removeIds) {
    if (set.has(id)) {
      set.delete(id);
      removed.push(id);
    }
  }
  if (added.length === 0 && removed.length === 0) {
    return { added, removed, skipped: "already-in-sync" };
  }

  data.anonymizace = {
    ...data.anonymizace,
    ANONYMIZOVANE: compactToRanges([...set].sort((a, b) => a - b)),
  };

  const trashDir = path.join(ADMIN_ROOTS.trash, trashTimestamp(), "meta");
  await ensureDir(trashDir);
  await fs.copyFile(
    META_TARGET_PATH,
    path.join(trashDir, LOKACE_STAVY_POZNAMKY_FILENAME),
  );
  await ensureDir(ADMIN_ROOTS.meta);
  await atomicWrite(META_TARGET_PATH, formatJsonCompactArrays(data) + "\n");
  return { added, removed };
}

export interface BulkFindAnonResult {
  photosRenamed: number;
  photosSkipped: number;
  jsonAdded: number[];
  jsonRemoved: number[];
  errors: { findId: number; filename: string; error: string }[];
}

/**
 * Bulk anonymise / de-anonymise a set of finds: rename every find's photo
 * files (pole 5 in the original + its crop, all ORIGINAL images of the
 * find) AND mirror the change into `LokaceStavyPoznamky.json` in a single
 * atomic write. A per-file rename failure is collected in `errors` but
 * never aborts the batch — the JSON write + sync safety net still apply.
 */
export async function setFindsAnonymized(
  findIds: readonly number[],
  anonymize: boolean,
): Promise<BulkFindAnonResult> {
  const ids = [...new Set(findIds)];
  if (ids.length === 0) {
    return {
      photosRenamed: 0,
      photosSkipped: 0,
      jsonAdded: [],
      jsonRemoved: [],
      errors: [],
    };
  }

  const images = await prisma.findImage.findMany({
    where: { findId: { in: ids }, imageType: ImageType.ORIGINAL },
    select: { findId: true, originalFilename: true },
  });

  let photosRenamed = 0;
  let photosSkipped = 0;
  const errors: BulkFindAnonResult["errors"] = [];
  for (const img of images) {
    let r: FindRenameResult;
    try {
      r = await renameFindPhotoAnon(img.originalFilename, anonymize);
    } catch (err) {
      errors.push({
        findId: img.findId,
        filename: img.originalFilename,
        error: (err as Error).message,
      });
      continue;
    }
    if (r.error) {
      errors.push({
        findId: img.findId,
        filename: img.originalFilename,
        error: r.error,
      });
    } else if (r.renamed) {
      photosRenamed += 1;
    } else {
      photosSkipped += 1;
    }
  }

  const json = anonymize
    ? await applyAnonJson(ids, [])
    : await applyAnonJson([], ids);

  return {
    photosRenamed,
    photosSkipped,
    jsonAdded: json.added,
    jsonRemoved: json.removed,
    errors,
  };
}
