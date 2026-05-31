"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { appendAudit } from "@/lib/admin/audit";
import { ADMIN_ROOTS, safeJoin } from "@/lib/admin/paths";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import {
  getFindFreePhotos,
  invalidateFindFreePhotosCache,
} from "@/lib/findFreePhotos";

/**
 * Reorder one free photo on a find by swapping its slot letter with
 * the neighbour above or below. The display order is driven entirely
 * by the slot letter in the filename (see `findFreePhotos.ts`), so
 * the swap is purely a filename mutation — no DB.
 *
 * Three-step rename to avoid the in-place collision when both files
 * share an extension:
 *
 *   1. A → tmp           (tmp filename intentionally does NOT match
 *                         the discovery regex `\d+[a-z]_FOTO\.ext`,
 *                         so a concurrent reader won't pick it up
 *                         mid-swap)
 *   2. B → A's new name  (B's content lands at A's old slot)
 *   3. tmp → B's new name (A's content lands at B's old slot)
 *
 * Each file keeps its original extension — only the slot letter
 * embedded in the filename changes. So WebP-A swapped with JPEG-B
 * yields WebP-at-slot-B and JPEG-at-slot-A.
 *
 * Returns void so it slots straight into `<form action={...}>` —
 * structured errors land in the audit log, the page rerenders on
 * the next revalidation. Same pattern as `deleteFreePhotoInline`.
 */
export async function moveFreePhoto(formData: FormData): Promise<void> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) return;
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const findIdRaw = formData.get("findId");
  const slotRaw = formData.get("slot");
  const directionRaw = formData.get("direction");

  if (typeof findIdRaw !== "string" || !/^\d+$/.test(findIdRaw)) return;
  if (typeof slotRaw !== "string" || !/^[a-z]$/.test(slotRaw)) return;
  if (
    typeof directionRaw !== "string" ||
    (directionRaw !== "up" && directionRaw !== "down")
  ) {
    return;
  }
  const findId = Number(findIdRaw);
  const slot = slotRaw;
  const direction = directionRaw as "up" | "down";

  const entries = await getFindFreePhotos(findId);
  const idx = entries.findIndex((e) => e.slot === slot);
  if (idx === -1) return;
  const targetIdx = direction === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= entries.length) {
    // Edge of the list — caller's UI already disables the button, so
    // arriving here means a double-click race. Silent no-op.
    return;
  }

  const a = entries[idx]!;
  const b = entries[targetIdx]!;
  const aExt = path.extname(a.filename); // e.g. ".webp"
  const bExt = path.extname(b.filename);

  // Each content keeps its own ext — only the slot letter swaps.
  const newAName = `${findId}${b.slot}_FOTO${aExt}`;
  const newBName = `${findId}${a.slot}_FOTO${bExt}`;

  // Tmp filename intentionally lacks the `_FOTO` token so it sits
  // outside the discovery regex while the swap is in flight — a
  // sibling PM2 worker that re-reads the dir mid-swap will skip it
  // instead of picking up a partial state.
  const tmpName = `${findId}_SWAP_${Date.now()}_${process.pid}${aExt}`;

  let aPath: string;
  let bPath: string;
  let tmpPath: string;
  let newAPath: string;
  let newBPath: string;
  try {
    aPath = safeJoin("freePhotos", a.filename);
    bPath = safeJoin("freePhotos", b.filename);
    tmpPath = safeJoin("freePhotos", tmpName);
    newAPath = safeJoin("freePhotos", newAName);
    newBPath = safeJoin("freePhotos", newBName);
  } catch (err) {
    await appendAudit({
      action: "file.rename",
      ip,
      credentialLabel,
      details: {
        scope: "free-photos",
        outcome: "error",
        reason: (err as Error).message,
        findId,
        slot,
        direction,
      },
    });
    return;
  }

  try {
    // Step 1: A → tmp. After this point A's old path no longer
    // exists, so step 2 can rename B onto A's old slot without
    // collision even when both files share an extension.
    await fs.rename(aPath, tmpPath);
    try {
      // Step 2: B → A's new slot (B's content moves to A's old position).
      await fs.rename(bPath, newBPath);
    } catch (err) {
      // Recovery — undo step 1 so we don't strand the file under
      // tmpName (which the gallery wouldn't list at all).
      await fs.rename(tmpPath, aPath).catch(() => {
        /* best-effort recovery */
      });
      throw err;
    }
    try {
      // Step 3: tmp → B's new slot (A's content lands at B's old
      // position). On failure here we already moved B successfully,
      // so we attempt to undo step 2 to restore a coherent state.
      await fs.rename(tmpPath, newAPath);
    } catch (err) {
      await fs.rename(newBPath, bPath).catch(() => {
        /* best-effort recovery */
      });
      await fs.rename(tmpPath, aPath).catch(() => {
        /* best-effort recovery */
      });
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendAudit({
      action: "file.rename",
      ip,
      credentialLabel,
      details: {
        scope: "free-photos",
        outcome: "error",
        reason: message,
        findId,
        slot,
        direction,
      },
    });
    return;
  }

  await appendAudit({
    action: "file.rename",
    ip,
    credentialLabel,
    details: {
      scope: "free-photos",
      outcome: "ok",
      reason: "reorder",
      findId,
      slot,
      direction,
      fromA: a.filename,
      fromB: b.filename,
      toA: newAName,
      toB: newBName,
    },
  });

  invalidateFindFreePhotosCache();
  // Bump the directory's mtime so sibling PM2 workers notice. The
  // fs.rename already does this, but POSIX rounds to 1s and a
  // fast double-rename could miss the bump — explicit utimes makes
  // the signal unambiguous.
  try {
    await fs.utimes(ADMIN_ROOTS.freePhotos, new Date(), new Date());
  } catch {
    /* best-effort */
  }

  revalidatePath("/admin/files/free-photos");
  revalidatePath("/admin/files/finds", "layout");
  // Public-facing pages — the /sbirka detail's gallery + the listing
  // badge order both flip. layout mode covers locale prefixes.
  revalidatePath("/sbirka", "layout");
}
