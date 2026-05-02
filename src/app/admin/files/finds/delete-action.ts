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

/** Move a file from `data/finds/` to `data/.trash/<ts>/finds/`. The
 *  destination directory is created on demand. We use `rename` rather
 *  than copy+unlink so the file disappears from the live tree only
 *  once the trash entry exists, and the operation stays inside the
 *  same filesystem (both paths under DATA_DIR), which keeps `rename`
 *  POSIX-atomic.
 *
 *  Hard-codes the source root (`findOriginals`) — clients can't pass
 *  a scope, so a tampered request can't redirect the delete out of
 *  the finds tree. Unicode-aware: resolves NFC vs NFD drift via
 *  resolveDiskPath so a name from a browser-normalised form still
 *  matches the disk-form entry. */
export async function deleteFind(formData: FormData): Promise<void> {
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
  const resolved = await resolveDiskPath("findOriginals", baseName);
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
    "finds",
  );
  await ensureDir(trashDir);
  const trashAbs = path.join(trashDir, resolved.name);

  await fs.rename(resolved.absolutePath, trashAbs);

  await appendAudit({
    action: "file.delete",
    ip,
    credentialLabel,
    details: {
      scope: "finds",
      file: resolved.name,
      size: sourceStat.size,
      trashRelative: path.relative(ADMIN_ROOTS.trash, trashAbs),
    },
  });

  revalidatePath("/admin/files/finds");
  redirect("/admin/files/finds");
}
