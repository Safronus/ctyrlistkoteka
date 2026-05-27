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
  error?: string;
}

/** Short-form crop allowance — mirrors scripts/sync.ts → scanFindDir.
 *  The convention lets a crop sit under `<id>.jpg` (or .jpeg / .png
 *  / .webp) rather than copying the full 6-segment original name.
 *  When renaming, we accept either form. */
const SHORT_CROP_RE = /^(\d+)\.(jpe?g|png|webp)$/i;

/** Renames a crop file. Unlike finds, crops accept both the full
 *  6-segment form AND the short `<id>.jpg` abbreviation. Rename does
 *  NOT touch the matching original — short ↔ long divergence between
 *  the two is intentional in the project's convention, and the
 *  "Originál a ořez se v názvu liší" check on /admin/checks excludes
 *  short crops from its mismatch test for exactly that reason. */
export async function renameCrop(
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

  // Validate: either the full 6-segment form OR the short `<id>.jpg`
  // abbreviation. If the long parser rejects AND short regex doesn't
  // match, refuse — the user is asking for a name the sync pipeline
  // wouldn't pick up.
  const parsedNew = parseFindFilename(newBase);
  const shortMatch = SHORT_CROP_RE.exec(newBase);
  if (!parsedNew.ok && !shortMatch) {
    return {
      ok: false,
      error: `Nový název neodpovídá ani plné formě (${parsedNew.error}), ani zkratce <id>.jpg|jpeg|png|webp.`,
    };
  }

  const oldResolved = await resolveDiskPath("findCrops", oldBase);
  if (!oldResolved) {
    return { ok: false, error: "Soubor neexistuje" };
  }

  let newAbs: string;
  try {
    newAbs = safeJoin("findCrops", newBase);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (await fileExists(newAbs)) {
    return {
      ok: false,
      error: `Cíl "${newBase}" už v crops/ existuje.`,
    };
  }

  await fs.rename(oldResolved.absolutePath, newAbs);

  await appendAudit({
    action: "file.rename",
    ip,
    credentialLabel,
    details: {
      scope: "crops",
      from: oldResolved.name,
      to: newBase,
      reason: "manual-rename",
    },
  });

  revalidatePath("/admin/files/crops");
  revalidatePath(`/admin/files/crops/${encodeURIComponent(oldResolved.name)}`);
  revalidatePath(`/admin/files/crops/${encodeURIComponent(newBase)}`);
  revalidatePath("/sbirka", "layout");

  return { ok: true, newFilename: newBase };
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
