"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { FindState } from "@prisma/client";
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

/** Inverse of `markFindDonated`: rewrites segment[3] back to NORMÁLNÍ
 *  (canonical form with diacritics — the only NORMAL token in
 *  FILENAME_STATE_MAP) and the note tail back to BezPoznámky, and
 *  cleans up the matching JSON entries so the next sync drops the
 *  DONATED state assignment + Find.notes value. */
const NORMAL_TOKEN = "NORMÁLNÍ";
const NO_NOTE_MARKER = "BezPoznámky";
const STATE_SEGMENT_INDEX = 3;
const NOTE_SEGMENT_START = 5;

export interface UnmarkDonatedResult {
  ok: boolean;
  filename: string;
  newFilename?: string;
  cropRenamed?: boolean;
  jsonUpdated?: boolean;
  error?: string;
}

export async function unmarkFindDonated(
  formData: FormData,
): Promise<UnmarkDonatedResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, filename: "?", error: "Unauthenticated" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const rawName = formData.get("name");
  if (typeof rawName !== "string" || rawName.length === 0) {
    return { ok: false, filename: "?", error: "Missing name" };
  }

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
  if (parsed.value.state !== FindState.DONATED) {
    return {
      ok: false,
      filename: resolved.name,
      error: `Stav v názvu musí být DAROVANY (je: ${parsed.value.state}).`,
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

  segments[STATE_SEGMENT_INDEX] = NORMAL_TOKEN;
  // Collapse a multi-segment legacy note back into the BezPoznámky
  // marker — symmetric with markFindDonated, which collapses any
  // existing tail into a single segment.
  segments.splice(
    NOTE_SEGMENT_START,
    segments.length - NOTE_SEGMENT_START,
    NO_NOTE_MARKER,
  );
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
    jsonUpdated = await updateMetaJsonForUndoDonation(findId);
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
      reason: "unmark-donated",
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

/** Removes findId from `stavy.DAROVANY` (surgically — preserves the
 *  user's range structure where possible) and deletes
 *  `poznamky[findId]`. Snapshots into `.trash/<ts>/meta/` before the
 *  atomic write. Returns true when something actually changed. */
async function updateMetaJsonForUndoDonation(
  findId: number,
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

  let changed = false;

  const currentDarovany = json.stavy.DAROVANY ?? [];
  const existingIds = parseRanges(currentDarovany);
  if (existingIds.includes(findId)) {
    // Re-emit sorted + compacted (matches markFindDonated's write
    // path). This also normalises any pre-existing manual
    // arrangement that included findId in a range — e.g.
    // "13600-13605" with id 13602 collapses to ["13600-13601",
    // "13603-13605"].
    const remaining = existingIds.filter((id) => id !== findId);
    json.stavy.DAROVANY = compactToRanges(remaining);
    changed = true;
  }

  const idStr = String(findId);
  if (idStr in json.poznamky) {
    const next = { ...json.poznamky };
    delete next[idStr];
    json.poznamky = next;
    changed = true;
  }

  if (!changed) return false;

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

