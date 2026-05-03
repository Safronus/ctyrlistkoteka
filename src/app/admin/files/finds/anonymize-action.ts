"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { atomicWrite, ensureDir, trashTimestamp } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { formatJsonCompactArrays } from "@/lib/admin/jsonFormat";
import {
  LOKACE_STAVY_POZNAMKY_FILENAME,
  lokaceStavyPoznamkySchema,
} from "@/lib/admin/jsonSchema";
import { ADMIN_ROOTS, safeBaseName, safeJoin } from "@/lib/admin/paths";
import { resolveDiskPath } from "@/lib/admin/scopes";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { parseFindFilename } from "@/lib/parseFilename";
import { compactToRanges, parseRanges } from "@/lib/parseRanges";

/** ANON flag lives in segment[4] of the find filename: NE = public,
 *  ANO = anonymised. Mark/unmark just toggles that token and keeps
 *  the JSON `anonymizace.ANONYMIZOVANE` set in lockstep. */
const ANON_SEGMENT_INDEX = 4;
const ANON_NO = "NE";
const ANON_YES = "ANO";

export interface AnonymizeFindResult {
  ok: boolean;
  filename: string;
  newFilename?: string;
  cropRenamed?: boolean;
  jsonUpdated?: boolean;
  error?: string;
}

/** Marks a find as anonymised (or removes the flag, when
 *  `anonymize=false`). Performs three coordinated edits:
 *    - data/finds/<name>:  segment[4]  NE ⇆ ANO
 *    - data/crops/<name>:  same edit when a crop counterpart exists
 *    - data/meta/LokaceStavyPoznamky.json:
 *        anonymize=true  → add findId to anonymizace.ANONYMIZOVANE
 *        anonymize=false → drop findId from the same array
 *      Re-emitted via parseRanges + compactToRanges so the resulting
 *      array stays sorted + range-merged (matches markFindDonated).
 *
 *  Sync: filename's pole 5 drives `Find.isAnonymized` directly in
 *  phaseFinds; phaseMeta then ORs in JSON anon ids and the recent
 *  convergence pass deletes the `findStateAssignment(id, ANONYMIZED)`
 *  row when an id is no longer covered. So both directions land in
 *  DB after the next `pnpm sync` without further wiring. */
export async function setFindAnonymized(
  formData: FormData,
): Promise<AnonymizeFindResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, filename: "?", error: "Unauthenticated" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const rawName = formData.get("name");
  const rawAnon = formData.get("anonymize");
  if (typeof rawName !== "string" || rawName.length === 0) {
    return { ok: false, filename: "?", error: "Missing name" };
  }
  if (rawAnon !== "1" && rawAnon !== "0") {
    return {
      ok: false,
      filename: rawName,
      error: "Field `anonymize` must be '0' or '1'",
    };
  }
  const anonymize = rawAnon === "1";

  let baseName: string;
  try {
    baseName = safeBaseName(rawName);
  } catch (err) {
    return { ok: false, filename: rawName, error: (err as Error).message };
  }

  const resolved = await resolveDiskPath("findOriginals", baseName);
  if (!resolved) {
    return { ok: false, filename: baseName, error: "Soubor neexistuje" };
  }

  const parsed = parseFindFilename(resolved.name);
  if (!parsed.ok) {
    return {
      ok: false,
      filename: resolved.name,
      error: `Název nelze rozparsovat: ${parsed.error}`,
    };
  }
  if (parsed.value.isAnonymized === anonymize) {
    return {
      ok: false,
      filename: resolved.name,
      error: anonymize
        ? "Nález už je v názvu označený jako anonymizovaný (ANO)."
        : "Nález je v názvu už neanonymizovaný (NE).",
    };
  }

  const dot = resolved.name.lastIndexOf(".");
  if (dot === -1) {
    return {
      ok: false,
      filename: resolved.name,
      error: "Název nemá příponu.",
    };
  }
  const stem = resolved.name.slice(0, dot);
  const ext = resolved.name.slice(dot);
  const segments = stem.split("+");
  if (segments.length < 6) {
    return {
      ok: false,
      filename: resolved.name,
      error: `Očekáváno alespoň 6 segmentů, je ${segments.length}.`,
    };
  }

  segments[ANON_SEGMENT_INDEX] = anonymize ? ANON_YES : ANON_NO;
  const newName = segments.join("+") + ext;
  if (newName === resolved.name) {
    return {
      ok: false,
      filename: resolved.name,
      error: "Nový název vyšel shodně se starým — žádná změna.",
    };
  }

  let newAbs: string;
  try {
    newAbs = safeJoin("findOriginals", newName);
  } catch (err) {
    return {
      ok: false,
      filename: resolved.name,
      error: (err as Error).message,
    };
  }
  if (await fileExists(newAbs)) {
    return {
      ok: false,
      filename: resolved.name,
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
        ok: false,
        filename: resolved.name,
        error: `Crop rename plan selhal: ${(err as Error).message}`,
      };
    }
    if (await fileExists(cropNewAbs)) {
      return {
        ok: false,
        filename: resolved.name,
        error: `Cíl crops/"${newName}" už existuje.`,
      };
    }
  }

  const findId = parsed.value.findId;
  let jsonUpdated = false;
  try {
    jsonUpdated = await updateMetaJsonForAnonymization(findId, anonymize);
  } catch (err) {
    return {
      ok: false,
      filename: resolved.name,
      error: `Aktualizace LokaceStavyPoznamky.json selhala: ${(err as Error).message}`,
    };
  }

  await fs.rename(resolved.absolutePath, newAbs);

  let cropRenamed = false;
  let cropRenameError: string | null = null;
  if (cropResolved && cropNewAbs) {
    try {
      await fs.rename(cropResolved.absolutePath, cropNewAbs);
      cropRenamed = true;
    } catch (err) {
      cropRenameError = (err as Error).message;
      console.error(
        "[admin/finds] crop rename failed after find rename succeeded",
        { from: cropResolved.absolutePath, to: cropNewAbs, error: err },
      );
    }
  }

  await appendAudit({
    action: "file.rename",
    ip,
    credentialLabel,
    details: {
      scope: "finds",
      from: resolved.name,
      to: newName,
      reason: anonymize ? "anonymize-on" : "anonymize-off",
      findId,
      cropRenamed,
      cropRenameError,
      jsonUpdated,
    },
  });

  revalidatePath("/admin/files/finds");
  revalidatePath(`/admin/files/finds/${encodeURIComponent(resolved.name)}`);
  revalidatePath(`/admin/files/finds/${encodeURIComponent(newName)}`);
  if (cropRenamed) {
    revalidatePath("/admin/files/crops");
    revalidatePath(`/admin/files/crops/${encodeURIComponent(resolved.name)}`);
    revalidatePath(`/admin/files/crops/${encodeURIComponent(newName)}`);
  }
  if (jsonUpdated) {
    revalidatePath("/admin/files/meta");
    revalidatePath("/admin/json/lokace-stavy-poznamky");
  }

  return {
    ok: true,
    filename: resolved.name,
    newFilename: newName,
    cropRenamed,
    jsonUpdated,
  };
}

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

/** Adds (or removes) findId in `anonymizace.ANONYMIZOVANE` and writes
 *  the file atomically. Snapshots into `.trash/<ts>/meta/` first. The
 *  array is re-emitted via parseRanges → compactToRanges so the
 *  result is canonical (sorted, ranges merged where consecutive). */
async function updateMetaJsonForAnonymization(
  findId: number,
  anonymize: boolean,
): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(META_TARGET_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }

  const parsed = JSON.parse(raw);
  const result = lokaceStavyPoznamkySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `JSON neprošel validací: ${result.error.issues
        .slice(0, 3)
        .map((i) => i.message)
        .join("; ")}`,
    );
  }
  const json = result.data;

  const current = json.anonymizace.ANONYMIZOVANE;
  const existingIds = parseRanges(current);
  const isPresent = existingIds.includes(findId);

  let nextIds: number[];
  if (anonymize && !isPresent) {
    nextIds = [...existingIds, findId];
  } else if (!anonymize && isPresent) {
    nextIds = existingIds.filter((id) => id !== findId);
  } else {
    return false;
  }

  json.anonymizace.ANONYMIZOVANE = compactToRanges(nextIds);

  const trashDir = path.join(ADMIN_ROOTS.trash, trashTimestamp(), "meta");
  await ensureDir(trashDir);
  await fs.copyFile(
    META_TARGET_PATH,
    path.join(trashDir, LOKACE_STAVY_POZNAMKY_FILENAME),
  );

  const formatted = formatJsonCompactArrays(json) + "\n";
  await ensureDir(ADMIN_ROOTS.meta);
  await atomicWrite(META_TARGET_PATH, formatted);
  return true;
}
