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

/** YYYYMMDDTHHmmss in UTC. Sortable, filename-safe, and unambiguous
 *  enough to identify a single deletion event. Two clicks within the
 *  same second collide; we accept that — the user is single-handed
 *  and within-second collisions would mean an automated burst, which
 *  isn't what /admin is built for. */
function trashTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:.]/g, "")
    .replace(/Z$/, "")
    .slice(0, 15); // YYYYMMDDTHHMMSS
}

/** Move a file from `data/finds/` to `data/.trash/<ts>/finds/`. The
 *  destination directory is created on demand. We use `rename` rather
 *  than copy+unlink so the file disappears from the live tree only
 *  once the trash entry exists, and the operation stays inside the
 *  same filesystem (both paths under DATA_DIR), which keeps `rename`
 *  POSIX-atomic.
 *
 *  Hard-codes the source root (`findOriginals`) — clients can't pass
 *  a scope, so a tampered request can't redirect the delete out of
 *  the finds tree. */
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
  const sourceAbs = safeJoin("findOriginals", baseName);

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

  const trashDir = path.join(
    ADMIN_ROOTS.trash,
    trashTimestamp(),
    "finds",
  );
  await ensureDir(trashDir);
  const trashAbs = path.join(trashDir, baseName);

  await fs.rename(sourceAbs, trashAbs);

  await appendAudit({
    action: "file.delete",
    ip,
    credentialLabel,
    details: {
      scope: "finds",
      file: baseName,
      size: sourceStat.size,
      trashRelative: path.relative(ADMIN_ROOTS.trash, trashAbs),
    },
  });

  revalidatePath("/admin/files/finds");
  // Detail route for the deleted file no longer exists; bounce back
  // to the listing rather than render a 404.
  redirect("/admin/files/finds");
}
