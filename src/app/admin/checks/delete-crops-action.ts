"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { wholePhotoCropOffenders } from "@/lib/admin/checks";
import { ensureDir, trashTimestamp } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import { resolveDiskPath } from "@/lib/admin/scopes";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";

export interface DeleteCropsResult {
  ok: boolean;
  error?: string;
  /** Crop source files moved to the trash. */
  trashed?: number;
  /** find_images CROP rows removed. */
  rowsDeleted?: number;
}

/**
 * Bulk "delete all crops for the whole-photo offenders". Re-derives the
 * offender set server-side (never trusts a client list) so it can only ever
 * remove crops the check currently flags, then:
 *   1. moves each crop source file to `data/.trash/<ts>/crops/` (recoverable),
 *   2. deletes the CROP `find_images` rows so the finds cleanly show no crop
 *      and drop out of this check.
 * The generated WebP variants are left orphaned (harmless, nothing references
 * them). The operator re-crops the originals elsewhere, re-uploads via
 * /admin and runs sync to rebuild the crops.
 */
export async function deleteWholePhotoCropsAction(): Promise<DeleteCropsResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) return { ok: false, error: "Unauthenticated" };
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const offenders = await wholePhotoCropOffenders();
  if (offenders.length === 0) return { ok: true, trashed: 0, rowsDeleted: 0 };

  const ts = trashTimestamp();
  const trashDir = path.join(ADMIN_ROOTS.trash, ts, "crops");
  await ensureDir(trashDir);

  let trashed = 0;
  const findIds: number[] = [];
  for (const o of offenders) {
    findIds.push(o.findId);
    // Resolve NFC-insensitively — the crop's DB name is NFC but the file on
    // disk (rsynced/exported from macOS) is often NFD, so a raw fs.rename on
    // the NFC name would miss it and silently leave the file as an orphan.
    const resolved = await resolveDiskPath("findCrops", o.crop.name);
    if (!resolved) continue; // not on disk — the DB row still gets removed
    try {
      await fs.rename(
        resolved.absolutePath,
        path.join(trashDir, resolved.name),
      );
      trashed += 1;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        return {
          ok: false,
          error: `Přesun ořezu do koše selhal (${resolved.name}): ${(err as Error).message}`,
        };
      }
    }
  }

  const del = await prisma.findImage.deleteMany({
    where: { findId: { in: findIds }, imageType: "CROP" },
  });

  await appendAudit({
    action: "file.delete",
    ip,
    credentialLabel,
    details: {
      scope: "crops-bulk-recrop",
      finds: findIds.length,
      trashed,
      rowsDeleted: del.count,
      batch: ts,
    },
  });

  revalidatePath("/admin/checks");
  revalidatePath("/[locale]/sbirka/[id]", "page");

  return { ok: true, trashed, rowsDeleted: del.count };
}
