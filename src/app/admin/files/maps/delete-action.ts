"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ensureDir, trashTimestamp } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { ADMIN_ROOTS, safeBaseName } from "@/lib/admin/paths";
import { assertMutableMapFile } from "@/lib/admin/mapsV2";
import { resolveDiskPath } from "@/lib/admin/scopes";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";

/** Move a single map from `data/maps/` to `data/.trash/<ts>/maps/`.
 *  Same rename-based atomic semantics as the finds/ delete; both
 *  source and trash sit under DATA_DIR so `rename` never crosses
 *  filesystems. Hard-codes the source root (`locationMaps`); the
 *  client cannot pass a scope. Unicode-aware via resolveDiskPath. */
export async function deleteMap(formData: FormData): Promise<void> {
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
  assertMutableMapFile(baseName);
  const resolved = await resolveDiskPath("locationMaps", baseName);
  if (!resolved) {
    throw new Error("Soubor neexistuje");
  }
  const sourceStat = await fs.stat(resolved.absolutePath);
  if (!sourceStat.isFile()) {
    throw new Error("Cíl není soubor");
  }

  const trashDir = path.join(ADMIN_ROOTS.trash, trashTimestamp(), "maps");
  await ensureDir(trashDir);
  const trashAbs = path.join(trashDir, resolved.name);

  await fs.rename(resolved.absolutePath, trashAbs);

  await appendAudit({
    action: "file.delete",
    ip,
    credentialLabel,
    details: {
      scope: "maps",
      file: resolved.name,
      size: sourceStat.size,
      trashRelative: path.relative(ADMIN_ROOTS.trash, trashAbs),
    },
  });

  revalidatePath("/admin/files/maps");
  redirect("/admin/files/maps");
}
