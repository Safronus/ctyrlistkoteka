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
import { MAX_BULK_DELETE_PER_REQUEST } from "./delete-types";
import type { BulkDeleteResult } from "./delete-types";

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

/** Bulk-delete server action. Accepts repeated `name` form fields
 *  and trashes each one. All files in a single bulk go into the
 *  same `data/.trash/<ts>/maps/` snapshot directory so the bucket
 *  represents a single user action — easier to find and undo as a
 *  unit than per-file timestamp dirs.
 *
 *  Per-file failures are reported back as `BulkDeleteResult` rows
 *  rather than aborting the whole batch; that way one stale name
 *  in the selection doesn't take the rest down. */
export async function deleteMapsBulk(
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
  if (rawNames.length === 0) {
    return { results: [] };
  }
  if (rawNames.length > MAX_BULK_DELETE_PER_REQUEST) {
    throw new Error(
      `Too many files in one bulk delete (max ${MAX_BULK_DELETE_PER_REQUEST})`,
    );
  }

  const ts = trashTimestamp();
  const trashDir = path.join(ADMIN_ROOTS.trash, ts, "maps");
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
      const resolved = await resolveDiskPath("locationMaps", baseName);
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
          scope: "maps",
          file: resolved.name,
          size: sourceStat.size,
          trashRelative: path.relative(ADMIN_ROOTS.trash, trashAbs),
          batch: ts,
        },
      });
      results.push({ filename: resolved.name, status: "ok" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[admin/maps-delete] bulk row failed", {
        name: raw,
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      results.push({
        filename: typeof raw === "string" ? raw : "?",
        status: "rejected",
        reason: message,
      });
    }
  }

  if (results.some((r) => r.status === "ok")) {
    revalidatePath("/admin/files/maps");
  }
  return { results };
}
