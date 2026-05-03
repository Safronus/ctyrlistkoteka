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

/** Token written into segment[3] of the find filename. The
 *  filename-state map accepts both DAROVANY and DAROVANÝ for the
 *  DONATED enum; we standardise on the ASCII spelling so the JSON
 *  `stavy.DAROVANY` key matches without an additional alias step. */
const DONATED_TOKEN = "DAROVANY";
const STATE_SEGMENT_INDEX = 3;
const NOTE_SEGMENT_START = 5;

export interface MarkDonatedResult {
  ok: boolean;
  filename: string;
  newFilename?: string;
  cropRenamed?: boolean;
  jsonUpdated?: boolean;
  error?: string;
}

/** Marks a find as donated by performing two coordinated filename
 *  edits on `data/finds/<name>` (and `data/crops/<name>` when a
 *  matching crop exists):
 *    segment[3] (state) → "DAROVANY"
 *    segments[5..]  (note) → user-supplied note text
 *
 *  Source-of-truth caveat: filenames are *signal*, not the DB drive
 *  for state/notes (see docs/filename-convention.md §6 — JSON wins).
 *  So in addition to the rename we patch `LokaceStavyPoznamky.json`:
 *  add findId to `stavy.DAROVANY` and set `poznamky[findId]=note`.
 *  The next sync's `phaseMeta` then upserts a `findStateAssignment`
 *  (DONATED) and writes `Find.notes` from the JSON.
 *
 *  Order matters for failure recovery: JSON first (cheap, recoverable
 *  from `.trash/<ts>/meta/`), then the original rename, then the crop
 *  rename. Crop failure is logged but doesn't fail the action — the
 *  primary intent (donate the find) already succeeded and the operator
 *  can fix the crop manually. */
export async function markFindDonated(
  formData: FormData,
): Promise<MarkDonatedResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, filename: "?", error: "Unauthenticated" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const rawName = formData.get("name");
  const rawNote = formData.get("note");
  if (typeof rawName !== "string" || rawName.length === 0) {
    return { ok: false, filename: "?", error: "Missing name" };
  }
  if (typeof rawNote !== "string") {
    return { ok: false, filename: rawName, error: "Chybí pole `note`" };
  }
  const note = rawNote.trim();
  if (note.length === 0) {
    return {
      ok: false,
      filename: rawName,
      error: "Poznámka je povinná — darovaný nález ji vyžaduje.",
    };
  }
  if (note.includes("+")) {
    return {
      ok: false,
      filename: rawName,
      error: "Poznámka nesmí obsahovat znak '+' (oddělovač segmentů názvu).",
    };
  }
  if (note.includes("/") || note.includes("\\") || note.includes("\0")) {
    return {
      ok: false,
      filename: rawName,
      error: "Poznámka nesmí obsahovat lomítka ani NUL.",
    };
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
  if (parsed.value.state !== FindState.NORMAL) {
    return {
      ok: false,
      filename: resolved.name,
      error: `Stav v názvu musí být NORMÁLNÍ (je: ${parsed.value.state}).`,
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

  segments[STATE_SEGMENT_INDEX] = DONATED_TOKEN;
  // Replace everything from index 5 onwards with the new note. Notes
  // are normally a single segment; if the legacy file had a multi-
  // segment note (rare — parser rejoins with '+'), this collapses
  // them to one. The user explicitly asked for "text after the last
  // '+'" so the single-segment form is the intended shape.
  segments.splice(
    NOTE_SEGMENT_START,
    segments.length - NOTE_SEGMENT_START,
    note,
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

  // Crop counterpart — same basename in data/crops/ if present.
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
    jsonUpdated = await updateMetaJsonForDonation(findId, note);
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
      reason: "mark-donated",
      findId,
      noteLength: note.length,
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

/** Adds findId to stavy.DAROVANY (when not already covered by an
 *  existing range) and writes `poznamky[findId]=note`. Snapshots into
 *  `.trash/<ts>/meta/` before the atomic write so the editor's manual
 *  undo workflow still applies. Returns true when something actually
 *  changed (caller uses this to drive revalidation). */
async function updateMetaJsonForDonation(
  findId: number,
  note: string,
): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(META_TARGET_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // No meta file = nothing to keep in sync. The rename still
      // happens; sync will see DONATED in the filename token (signal
      // only) but won't write findStateAssignment without the JSON.
      // Acceptable — the operator can populate the JSON later and a
      // rerun of sync will catch up.
      return false;
    }
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

  // The Zod schema declares DAROVANY as a required key, but its
  // shape is built via a Record<string,...> map so TS sees the field
  // as possibly undefined. Coerce to an empty array — at runtime
  // strict() guarantees the field exists once safeParse has passed.
  const currentDarovany = json.stavy.DAROVANY ?? [];
  const existingIds = parseRanges(currentDarovany);
  if (!existingIds.includes(findId)) {
    // Re-emit the whole array sorted + compacted so a new id slots
    // into the right position (and merges with an adjacent range
    // when consecutive). Without this the singleton would just get
    // appended to the end and the file would drift away from the
    // tidy form the user maintains.
    const merged = compactToRanges([...existingIds, findId]);
    json.stavy.DAROVANY = merged;
    changed = true;
  }

  const idStr = String(findId);
  if (json.poznamky[idStr] !== note) {
    json.poznamky = { ...json.poznamky, [idStr]: note };
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
