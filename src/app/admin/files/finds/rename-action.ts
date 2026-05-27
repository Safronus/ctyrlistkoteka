"use server";

import { promises as fs } from "node:fs";
import { revalidatePath } from "next/cache";
import { appendAudit } from "@/lib/admin/audit";
import { safeBaseName, safeJoin } from "@/lib/admin/paths";
import { resolveDiskPath } from "@/lib/admin/scopes";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { parseFindFilename } from "@/lib/parseFilename";

export interface RenameResult {
  ok: boolean;
  newFilename?: string;
  cropRenamed?: boolean;
  error?: string;
}

/** Renames an original find photo on disk. The new name must pass
 *  parseFindFilename (so the 6-segment convention is preserved + the
 *  STATE token is in the legal vocabulary). When a matching crop
 *  exists under the SAME basename, it's renamed in lockstep so the
 *  "Originál a ořez se v názvu liší" check stays green. Short-form
 *  crops (`<id>.jpg`) are intentionally separate names and stay put.
 *
 *  fs.rename is atomic on the same filesystem — no trash snapshot
 *  needed (the file isn't lost, just under a new name). If the
 *  crop-side rename fails after the original-side succeeds, the
 *  audit log captures the divergence so the operator can fix the
 *  crop by hand on its own detail page. */
export async function renameFindOriginal(
  formData: FormData,
): Promise<RenameResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, error: "Unauthenticated" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const rawOld = formData.get("oldName");
  const rawNew = formData.get("newName");
  if (typeof rawOld !== "string" || rawOld.length === 0) {
    return { ok: false, error: "Chybí oldName" };
  }
  if (typeof rawNew !== "string" || rawNew.length === 0) {
    return { ok: false, error: "Chybí newName" };
  }

  let oldBase: string;
  let newBase: string;
  try {
    oldBase = safeBaseName(rawOld);
    newBase = safeBaseName(rawNew);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (oldBase === newBase) {
    return { ok: false, error: "Nový název je stejný jako starý." };
  }

  // New name must parse — parseFindFilename catches a typo in any
  // segment (wrong state token, missing `+`, etc.) before we touch
  // disk. Short-form (`<id>.jpg`) isn't valid for originals — only
  // crops accept that abbreviation.
  const parsedNew = parseFindFilename(newBase);
  if (!parsedNew.ok) {
    return {
      ok: false,
      error: `Nový název nejde rozparsovat: ${parsedNew.error}`,
    };
  }

  const oldResolved = await resolveDiskPath("findOriginals", oldBase);
  if (!oldResolved) {
    return { ok: false, error: "Soubor neexistuje" };
  }

  let newAbs: string;
  try {
    newAbs = safeJoin("findOriginals", newBase);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (await fileExists(newAbs)) {
    return {
      ok: false,
      error: `Cíl "${newBase}" už v finds/ existuje.`,
    };
  }

  // Look for a matching crop with the SAME name as the original
  // (long-form). Short-form crops (`<id>.jpg`) skip this rename —
  // they're an intentional abbreviation that lives apart from the
  // original's full name. The crop's new target must also be
  // collision-free.
  const cropResolved = await resolveDiskPath("findCrops", oldResolved.name);
  let cropNewAbs: string | null = null;
  if (cropResolved) {
    try {
      cropNewAbs = safeJoin("findCrops", newBase);
    } catch (err) {
      return { ok: false, error: `Crop rename plán selhal: ${(err as Error).message}` };
    }
    if (await fileExists(cropNewAbs)) {
      return {
        ok: false,
        error: `Cíl crops/"${newBase}" už existuje.`,
      };
    }
  }

  await fs.rename(oldResolved.absolutePath, newAbs);

  let cropRenamed = false;
  let cropRenameError: string | null = null;
  if (cropResolved && cropNewAbs) {
    try {
      await fs.rename(cropResolved.absolutePath, cropNewAbs);
      cropRenamed = true;
    } catch (err) {
      cropRenameError = (err as Error).message;
      console.error(
        "[admin/finds/rename] crop rename failed after original-side success",
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
      from: oldResolved.name,
      to: newBase,
      reason: "manual-rename",
      cropRenamed,
      cropRenameError,
    },
  });

  revalidatePath("/admin/files/finds");
  revalidatePath(`/admin/files/finds/${encodeURIComponent(oldResolved.name)}`);
  revalidatePath(`/admin/files/finds/${encodeURIComponent(newBase)}`);
  if (cropRenamed) {
    revalidatePath("/admin/files/crops");
    revalidatePath(`/admin/files/crops/${encodeURIComponent(oldResolved.name)}`);
    revalidatePath(`/admin/files/crops/${encodeURIComponent(newBase)}`);
  }
  // Public listing reads find_images.original_filename — admin
  // rename doesn't touch the DB, but the next sync will pick the
  // new name up, so we still bust /sbirka so a refreshed visitor
  // sees the canonical state on next ISR re-render.
  revalidatePath("/sbirka", "layout");

  return { ok: true, newFilename: newBase, cropRenamed };
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}
