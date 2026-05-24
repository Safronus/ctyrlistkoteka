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
import { ADMIN_ROOTS, safeBaseName } from "@/lib/admin/paths";
import { resolveDiskPath } from "@/lib/admin/scopes";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { parseFindFilename } from "@/lib/parseFilename";
import { compactToRanges, parseRanges } from "@/lib/parseRanges";

const META_TARGET_PATH = path.join(
  ADMIN_ROOTS.meta,
  LOKACE_STAVY_POZNAMKY_FILENAME,
);

export interface ToggleGigantResult {
  ok: boolean;
  filename: string;
  /** New state of the GIGANT flag after the action (true = marked,
   *  false = unmarked). Mirrors `findStateAssignment(GIGANT)` that
   *  the next sync run will reconcile from the JSON. */
  isGigant?: boolean;
  jsonUpdated?: boolean;
  error?: string;
}

/**
 * Adds (or removes) a find ID in `stavy.GIGANT` in
 * `LokaceStavyPoznamky.json`. Unlike the donated state, GIGANT is
 * a purely cosmetic flag — no filename rename, no crop counterpart,
 * no note required. The next `pnpm sync` then upserts a
 * `findStateAssignment(GIGANT)` row off the JSON entry, and the
 * public UI surfaces it as a badge.
 *
 * Snapshots the meta file into `.trash/<ts>/meta/` before writing so
 * the editor's manual-undo workflow still applies. The write itself
 * is atomic (temp file + rename), so a partial write can never land.
 */
export async function toggleFindGigant(
  formData: FormData,
): Promise<ToggleGigantResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, filename: "?", error: "Unauthenticated" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const rawName = formData.get("name");
  const rawMark = formData.get("mark");
  if (typeof rawName !== "string" || rawName.length === 0) {
    return { ok: false, filename: "?", error: "Missing name" };
  }
  if (rawMark !== "1" && rawMark !== "0") {
    return {
      ok: false,
      filename: rawName,
      error: "Pole `mark` musí být '0' nebo '1'",
    };
  }
  const mark = rawMark === "1";

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
  const findId = parsed.value.findId;

  let jsonUpdated: boolean;
  try {
    jsonUpdated = await updateGigantInJson(findId, mark);
  } catch (err) {
    return {
      ok: false,
      filename: resolved.name,
      error: `Aktualizace JSONu selhala: ${(err as Error).message}`,
    };
  }

  await appendAudit({
    action: "json.update",
    ip,
    credentialLabel,
    details: {
      scope: "stavy.GIGANT",
      findId,
      mark,
      jsonUpdated,
    },
  });

  if (jsonUpdated) {
    revalidatePath("/admin/files/finds");
    revalidatePath(`/admin/files/finds/${encodeURIComponent(resolved.name)}`);
    revalidatePath("/admin/files/meta");
    revalidatePath("/admin/json/lokace-stavy-poznamky");
  }

  return {
    ok: true,
    filename: resolved.name,
    isGigant: mark,
    jsonUpdated,
  };
}

/** Adds (or removes) `findId` in `stavy.GIGANT` in the meta JSON.
 *  Returns true when the file changed, false when the requested
 *  state already matched (idempotent — repeat clicks are safe). */
async function updateGigantInJson(
  findId: number,
  mark: boolean,
): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(META_TARGET_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      if (!mark) return false; // nothing to remove
      // Bootstrap a minimal valid JSON with just stavy.GIGANT set.
      // This is rare on prod but lets dev environments start cold.
      const seed = {
        anonymizace: { ANONYMIZOVANE: [] },
        lokace: {},
        poznamky: {},
        stavy: {
          BEZFOTKY: [],
          BEZGPS: [],
          BEZLOKACE: [],
          DAROVANY: [],
          GIGANT: [String(findId)],
          "LOKACE-NEEXISTUJE": [],
          NEUTRZEN: [],
          ZTRACENY: [],
        },
      };
      const formatted = formatJsonCompactArrays(seed) + "\n";
      await ensureDir(ADMIN_ROOTS.meta);
      await atomicWrite(META_TARGET_PATH, formatted);
      return true;
    }
    throw err;
  }

  const parsedJson = JSON.parse(raw);
  const result = lokaceStavyPoznamkySchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(
      `JSON neprošel validací: ${result.error.issues
        .slice(0, 3)
        .map((i) => i.message)
        .join("; ")}`,
    );
  }
  const json = result.data;

  // Strict schema guarantees the key exists post-safeParse; the `??`
  // is a TS-only coalesce because the Record<string, ...> typing
  // can't prove key presence to the type checker.
  const currentGigant = json.stavy.GIGANT ?? [];
  const existingIds = parseRanges(currentGigant);
  const already = existingIds.includes(findId);
  if (mark && already) return false;
  if (!mark && !already) return false;

  const nextIds = mark
    ? [...existingIds, findId]
    : existingIds.filter((id) => id !== findId);
  json.stavy.GIGANT = compactToRanges(nextIds);

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
