"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ensureDir, trashTimestamp } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { ADMIN_ROOTS, safeBaseName } from "@/lib/admin/paths";
import { resolveDiskPath } from "@/lib/admin/scopes";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { invalidateFindFreePhotosCache } from "@/lib/findFreePhotos";
import { MAX_BULK_DELETE_PER_REQUEST } from "../_shared/list-types";
import type { BulkDeleteResult } from "../_shared/list-types";

const TRASH_SUBDIR = "free-photos";

/** Shared body for both the redirecting standalone-scope variant and
 *  the inline find-detail variant. Pulled out so the only difference
 *  between the two exported actions is whether they call `redirect()`
 *  at the end. */
async function performDeleteFreePhoto(formData: FormData): Promise<void> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    throw new Error("Unauthenticated");
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const rawName = formData.get("name");
  if (typeof rawName !== "string" || rawName.length === 0) {
    throw new Error("Missing name");
  }
  const baseName = safeBaseName(rawName);
  const resolved = await resolveDiskPath("freePhotos", baseName);
  if (!resolved) {
    throw new Error("Soubor neexistuje");
  }
  const sourceStat = await fs.stat(resolved.absolutePath);
  if (!sourceStat.isFile()) {
    throw new Error("Cíl není soubor");
  }

  const trashDir = path.join(
    ADMIN_ROOTS.trash,
    trashTimestamp(),
    TRASH_SUBDIR,
  );
  await ensureDir(trashDir);
  const trashAbs = path.join(trashDir, resolved.name);

  await fs.rename(resolved.absolutePath, trashAbs);
  invalidateFindFreePhotosCache();

  await appendAudit({
    action: "file.delete",
    ip,
    credentialLabel,
    details: {
      scope: "free-photos",
      file: resolved.name,
      size: sourceStat.size,
      trashRelative: path.relative(ADMIN_ROOTS.trash, trashAbs),
    },
  });

  revalidatePath("/admin/files/free-photos");
  revalidatePath("/admin/files/finds", "layout");
  // Public detail page + listing: see comment in
  // src/app/admin/files/finds/free-photos-action.ts for the rationale.
  revalidatePath("/sbirka", "layout");
}

/** Move one free photo from `generated/find-free-photos/` to
 *  `data/.trash/<ts>/free-photos/`. Mirrors the donation-photo delete
 *  flow — cross-filesystem renames may fall back to copy+unlink.
 *  Redirects to the standalone scope listing on success — appropriate
 *  for the button on the file detail page (the detail itself would
 *  404 after the file moves to trash). */
export async function deleteFreePhoto(formData: FormData): Promise<void> {
  await performDeleteFreePhoto(formData);
  redirect("/admin/files/free-photos");
}

/** Same delete, no redirect. The find-detail card invokes this so the
 *  user stays on the find's admin page and sees the row vanish on
 *  re-render. revalidatePath inside `performDeleteFreePhoto` covers
 *  the RSC refresh. */
export async function deleteFreePhotoInline(
  formData: FormData,
): Promise<void> {
  await performDeleteFreePhoto(formData);
}

/** Bulk variant — mirrors `deleteDonationPhotosBulk`. */
export async function deleteFreePhotosBulk(
  formData: FormData,
): Promise<{ results: BulkDeleteResult[] }> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    throw new Error("Unauthenticated");
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const rawNames = formData.getAll("name");
  if (rawNames.length === 0) return { results: [] };
  if (rawNames.length > MAX_BULK_DELETE_PER_REQUEST) {
    throw new Error(
      `Too many files in one bulk delete (max ${MAX_BULK_DELETE_PER_REQUEST})`,
    );
  }

  const ts = trashTimestamp();
  const trashDir = path.join(ADMIN_ROOTS.trash, ts, TRASH_SUBDIR);
  await ensureDir(trashDir);

  const results: BulkDeleteResult[] = [];
  for (const raw of rawNames) {
    if (typeof raw !== "string" || raw.length === 0) {
      results.push({
        filename: typeof raw === "string" ? raw : "?",
        status: "rejected",
        reason: "Položka není název",
      });
      continue;
    }
    try {
      const baseName = safeBaseName(raw);
      const resolved = await resolveDiskPath("freePhotos", baseName);
      if (!resolved) {
        results.push({
          filename: baseName,
          status: "rejected",
          reason: "Soubor neexistuje",
        });
        continue;
      }
      const sourceStat = await fs.stat(resolved.absolutePath);
      if (!sourceStat.isFile()) {
        results.push({
          filename: resolved.name,
          status: "rejected",
          reason: "Cíl není soubor",
        });
        continue;
      }
      const trashAbs = path.join(trashDir, resolved.name);
      await fs.rename(resolved.absolutePath, trashAbs);
      await appendAudit({
        action: "file.delete",
        ip,
        credentialLabel,
        details: {
          scope: "free-photos",
          file: resolved.name,
          size: sourceStat.size,
          trashRelative: path.relative(ADMIN_ROOTS.trash, trashAbs),
          batch: ts,
        },
      });
      results.push({ filename: resolved.name, status: "ok" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[admin/free-photos-delete] bulk row failed", {
        name: raw,
        message,
      });
      results.push({
        filename: typeof raw === "string" ? raw : "?",
        status: "rejected",
        reason: message,
      });
    }
  }

  if (results.some((r) => r.status === "ok")) {
    invalidateFindFreePhotosCache();
    revalidatePath("/admin/files/free-photos");
    revalidatePath("/admin/files/finds", "layout");
    revalidatePath("/sbirka", "layout");
  }
  return { results };
}
