"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { atomicWrite, ensureDir, trashTimestamp } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { LOKACE_STAVY_POZNAMKY_FILENAME } from "@/lib/admin/jsonSchema";
import { createBackup, readBackup, safeBackupName } from "@/lib/admin/lspBackups";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";

const META_TARGET_PATH = path.join(
  ADMIN_ROOTS.meta,
  LOKACE_STAVY_POZNAMKY_FILENAME,
);

export interface RestoreBackupResult {
  ok: boolean;
  restored?: string;
  error?: string;
}

/** Restores LokaceStavyPoznamky.json from a rotating backup. Snapshots
 *  the current file first (into the same rotation + .trash) so the
 *  restore itself is undoable, then atomically overwrites the live
 *  file with the backup's bytes. */
export async function restoreLspBackup(
  formData: FormData,
): Promise<RestoreBackupResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, error: "Unauthenticated" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const nameRaw = formData.get("name");
  if (typeof nameRaw !== "string") {
    return { ok: false, error: "Chybí pole `name`" };
  }
  let name: string;
  try {
    name = safeBackupName(nameRaw);
  } catch {
    return { ok: false, error: `Neplatný název zálohy: ${nameRaw}` };
  }

  let content: string;
  try {
    content = await readBackup(name);
  } catch (err) {
    return {
      ok: false,
      error: `Zálohu nelze načíst: ${(err as Error).message}`,
    };
  }

  // Don't restore garbage — the backup must at least parse as JSON.
  try {
    JSON.parse(content);
  } catch {
    return { ok: false, error: "Záloha není validní JSON." };
  }

  // Snapshot the CURRENT live file before overwriting: into the
  // rotation (so this restore is itself reversible) and into .trash.
  try {
    await createBackup();
    try {
      await fs.access(META_TARGET_PATH);
      const trashDir = path.join(ADMIN_ROOTS.trash, trashTimestamp(), "meta");
      await ensureDir(trashDir);
      await fs.copyFile(
        META_TARGET_PATH,
        path.join(trashDir, LOKACE_STAVY_POZNAMKY_FILENAME),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  } catch (err) {
    return {
      ok: false,
      error: `Záloha aktuálního souboru před obnovou selhala: ${(err as Error).message}`,
    };
  }

  await ensureDir(ADMIN_ROOTS.meta);
  await atomicWrite(META_TARGET_PATH, content);

  await appendAudit({
    action: "json.update",
    ip,
    credentialLabel,
    details: {
      file: LOKACE_STAVY_POZNAMKY_FILENAME,
      reason: "restore-backup",
      backup: name,
    },
  });

  revalidatePath("/admin/files/meta");
  revalidatePath("/admin/json/lokace-stavy-poznamky");
  revalidatePath(
    `/admin/files/meta/${encodeURIComponent(LOKACE_STAVY_POZNAMKY_FILENAME)}`,
  );

  return { ok: true, restored: name };
}
