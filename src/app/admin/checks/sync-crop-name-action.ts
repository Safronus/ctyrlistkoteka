"use server";

import { promises as fs } from "node:fs";
import { revalidatePath } from "next/cache";
import { appendAudit } from "@/lib/admin/audit";
import { ADMIN_ROOTS, safeJoin } from "@/lib/admin/paths";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { parseFindFilename } from "@/lib/parseFilename";

export interface SyncCropNameResult {
  ok: boolean;
  /** Resolved current names on disk, returned for the audit / client
   *  log. Useful when the user wants to confirm what actually
   *  happened — the server's view of "current" can diverge from the
   *  client's view if the row was rendered before a manual rename. */
  originalName?: string;
  oldCropName?: string;
  newCropName?: string;
  error?: string;
}

/** Short-form crop allowance — same regex as
 *  src/app/admin/files/crops/rename-action.ts. The convention lets
 *  a crop sit under `<id>.jpg` (or .jpeg / .png / .webp) rather
 *  than copying the original's full name. */
const SHORT_CROP_RE = /^(\d+)\.(jpe?g|png|webp)$/i;

/** Renames the crop file for a given find ID so its basename matches
 *  the ORIGINAL's basename on disk, while preserving the crop's own
 *  extension (HEIC original + JPG crop is the common case; we don't
 *  want to mint a .HEIC crop).
 *
 *  This action reads BOTH filenames fresh from disk — earlier we
 *  passed the original's filename from the client (the check page's
 *  cached offender row) and that data could be stale after a manual
 *  rename on the original's detail page. Re-reading disk-side
 *  eliminates the staleness window entirely.
 *
 *  Failure modes:
 *   - No original on disk for this find ID → ok:false
 *   - No crop on disk for this find ID → ok:false
 *   - Crop is short-form (`<id>.jpg`) → ok:false (the abbreviation
 *     is intentional; the operator shouldn't pave over it from
 *     here, the detail-page rename popover is the correct tool)
 *   - Names already match → ok:false ("nothing to do")
 *   - Target collision in crops/ → ok:false
 *   - fs.rename throws → bubbles to client try/catch */
export async function syncCropNameToOriginal(
  formData: FormData,
): Promise<SyncCropNameResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, error: "Unauthenticated" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const findIdRaw = formData.get("findId");
  if (typeof findIdRaw !== "string" || !/^\d+$/.test(findIdRaw)) {
    return { ok: false, error: "Chybí nebo neplatné findId." };
  }
  const findId = Number(findIdRaw);

  // Walk both directories once. Cheap for the project's ~17k file
  // count + keeps the disk read close to the lookup so the chosen
  // names can't go stale between read and rename.
  let originalNames: string[];
  let cropNames: string[];
  try {
    originalNames = await fs.readdir(ADMIN_ROOTS.findOriginals);
    cropNames = await fs.readdir(ADMIN_ROOTS.findCrops);
  } catch (err) {
    return {
      ok: false,
      error: `Adresář s nálezy nebo ořezy nelze přečíst: ${
        (err as Error).message
      }`,
    };
  }

  const findIdForName = (name: string): number | null => {
    if (name.startsWith(".")) return null;
    const parsed = parseFindFilename(name);
    if (parsed.ok) return parsed.value.findId;
    const short = SHORT_CROP_RE.exec(name);
    if (short) return Number(short[1]);
    return null;
  };

  const original = originalNames.find((n) => findIdForName(n) === findId);
  if (!original) {
    return {
      ok: false,
      error: `Pro nález #${findId} není v data/finds/ žádný originál.`,
    };
  }

  const crop = cropNames.find((n) => findIdForName(n) === findId);
  if (!crop) {
    return {
      ok: false,
      error: `Pro nález #${findId} není v data/crops/ žádný ořez.`,
    };
  }

  // Refuse to touch short-form crops — the `<id>.jpg` shorthand is
  // an intentional divergence from the original's full name. The
  // detail-page rename popover is the right place to convert a
  // short-form crop to long-form (or vice versa).
  if (SHORT_CROP_RE.test(crop)) {
    return {
      ok: false,
      error: `Ořez "${crop}" je v krátké formě (<id>.jpg) — krátká forma je záměrná zkratka. Pokud chceš přejmenovat, použij detail ořezu.`,
    };
  }

  const splitExt = (name: string): { stem: string; ext: string } => {
    const dot = name.lastIndexOf(".");
    if (dot === -1) return { stem: name, ext: "" };
    return { stem: name.slice(0, dot), ext: name.slice(dot) };
  };

  const { stem: originalStem } = splitExt(original);
  const { ext: cropExt } = splitExt(crop);
  const newCropName = originalStem + cropExt;
  if (newCropName === crop) {
    return {
      ok: false,
      originalName: original,
      oldCropName: crop,
      error: "Ořez už má shodný název s originálem — není co dělat.",
    };
  }

  let newAbs: string;
  try {
    newAbs = safeJoin("findCrops", newCropName);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  try {
    await fs.access(newAbs);
    return {
      ok: false,
      error: `Cíl "${newCropName}" už v crops/ existuje — nemůžu přepsat.`,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const oldAbs = safeJoin("findCrops", crop);
  await fs.rename(oldAbs, newAbs);

  await appendAudit({
    action: "file.rename",
    ip,
    credentialLabel,
    details: {
      scope: "crops",
      from: crop,
      to: newCropName,
      reason: "sync-with-original",
      findId,
      originalName: original,
    },
  });

  revalidatePath("/admin/files/crops");
  revalidatePath(`/admin/files/crops/${encodeURIComponent(crop)}`);
  revalidatePath(`/admin/files/crops/${encodeURIComponent(newCropName)}`);
  revalidatePath("/admin/checks");
  revalidatePath("/sbirka", "layout");

  return {
    ok: true,
    originalName: original,
    oldCropName: crop,
    newCropName,
  };
}
