"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { appendAudit } from "@/lib/admin/audit";
import { ADMIN_ROOTS, safeBaseName } from "@/lib/admin/paths";
import { resolveDiskPath } from "@/lib/admin/scopes";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import type { BulkRenameResult } from "../_shared/list-types";

// "use server" files only allow async exports — keep the prefix
// internal. The button + detail page hardcode the literal too.
const NONEXISTENT_PREFIX = "NEEXISTUJE-";

/** Rename a single map filename to add the `NEEXISTUJE-` prefix.
 *  Used when a real-world location no longer exists (field paved
 *  over, building demolished, …) and we want to keep the historical
 *  data without it being picked up as an active map by `pnpm sync`.
 *  Idempotent: a name that already starts with the prefix is a no-op
 *  (returned as `rejected` with a clear reason). */
export async function markMapNonexistent(formData: FormData): Promise<void> {
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
  if (baseName.startsWith(NONEXISTENT_PREFIX)) {
    throw new Error("Soubor už má prefix NEEXISTUJE-");
  }
  const resolved = await resolveDiskPath("locationMaps", baseName);
  if (!resolved) {
    throw new Error("Soubor neexistuje");
  }
  const newName = NONEXISTENT_PREFIX + resolved.name;
  const newAbs = path.join(ADMIN_ROOTS.locationMaps, newName);

  // If a NEEXISTUJE-<same name> already exists (somehow), refuse —
  // would clobber an earlier rename's history.
  try {
    await fs.access(newAbs);
    throw new Error(`Cíl "${newName}" už existuje`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  await fs.rename(resolved.absolutePath, newAbs);

  await appendAudit({
    action: "file.rename",
    ip,
    credentialLabel,
    details: {
      scope: "maps",
      from: resolved.name,
      to: newName,
      reason: "marked-nonexistent",
    },
  });

  revalidatePath("/admin/files/maps");
  redirect(`/admin/files/maps/${encodeURIComponent(newName)}`);
}

/** Bulk variant — applies the prefix to many maps in one go. */
export async function markMapsNonexistentBulk(
  formData: FormData,
): Promise<{ results: BulkRenameResult[] }> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    throw new Error("Unauthenticated");
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const rawNames = formData.getAll("name");
  if (rawNames.length === 0) return { results: [] };

  const results: BulkRenameResult[] = [];
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
      if (baseName.startsWith(NONEXISTENT_PREFIX)) {
        results.push({
          filename: baseName,
          status: "rejected",
          reason: "Už má prefix NEEXISTUJE-",
        });
        continue;
      }
      const resolved = await resolveDiskPath("locationMaps", baseName);
      if (!resolved) {
        results.push({
          filename: baseName,
          status: "rejected",
          reason: "Soubor neexistuje",
        });
        continue;
      }
      const newName = NONEXISTENT_PREFIX + resolved.name;
      const newAbs = path.join(ADMIN_ROOTS.locationMaps, newName);
      try {
        await fs.access(newAbs);
        results.push({
          filename: resolved.name,
          status: "rejected",
          reason: `Cíl "${newName}" už existuje`,
        });
        continue;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      await fs.rename(resolved.absolutePath, newAbs);
      await appendAudit({
        action: "file.rename",
        ip,
        credentialLabel,
        details: {
          scope: "maps",
          from: resolved.name,
          to: newName,
          reason: "marked-nonexistent",
        },
      });
      results.push({
        filename: resolved.name,
        status: "ok",
        to: newName,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[admin/maps-rename] bulk row failed", {
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
    revalidatePath("/admin/files/maps");
  }
  return { results };
}
