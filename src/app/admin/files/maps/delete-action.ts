"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ensureDir } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { ADMIN_ROOTS, safeBaseName, safeJoin } from "@/lib/admin/paths";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";

function trashTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:.]/g, "")
    .replace(/Z$/, "")
    .slice(0, 15);
}

/** Move a file from `data/maps/` to `data/.trash/<ts>/maps/`. Same
 *  rename-based atomic semantics as the finds/ delete action; both
 *  source and trash sit under DATA_DIR so the rename never crosses
 *  filesystems. Hard-codes the source root (`locationMaps`); the
 *  client cannot pass a scope. */
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
  const sourceAbs = safeJoin("locationMaps", baseName);

  let sourceStat;
  try {
    sourceStat = await fs.stat(sourceAbs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Soubor neexistuje");
    }
    throw err;
  }
  if (!sourceStat.isFile()) {
    throw new Error("Cíl není soubor");
  }

  const trashDir = path.join(ADMIN_ROOTS.trash, trashTimestamp(), "maps");
  await ensureDir(trashDir);
  const trashAbs = path.join(trashDir, baseName);

  await fs.rename(sourceAbs, trashAbs);

  await appendAudit({
    action: "file.delete",
    ip,
    credentialLabel,
    details: {
      scope: "maps",
      file: baseName,
      size: sourceStat.size,
      trashRelative: path.relative(ADMIN_ROOTS.trash, trashAbs),
    },
  });

  revalidatePath("/admin/files/maps");
  redirect("/admin/files/maps");
}
