"use server";

import { revalidatePath } from "next/cache";
import { appendAudit } from "@/lib/admin/audit";
import { safeBaseName } from "@/lib/admin/paths";
import { resolveDiskPath } from "@/lib/admin/scopes";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { parseFindFilename } from "@/lib/parseFilename";
import { writeFindNoteOverride } from "@/lib/findNoteOverrides";

export interface SetNoteOverrideResult {
  ok: boolean;
  findId?: number;
  error?: string;
}

/**
 * Upsert a find's web-display note override (CS + optional EN) in
 * `data/.admin/find-note-overrides.json`. Does NOT touch the filename or
 * the LSP JSON — it's a pure display layer read by the public find page's
 * note banner. Clearing both variants removes the override.
 */
export async function setFindNoteOverride(
  formData: FormData,
): Promise<SetNoteOverrideResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) return { ok: false, error: "Unauthenticated" };
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const rawName = formData.get("name");
  const cs =
    typeof formData.get("cs") === "string" ? String(formData.get("cs")) : "";
  const en =
    typeof formData.get("en") === "string" ? String(formData.get("en")) : "";
  if (typeof rawName !== "string" || rawName.length === 0) {
    return { ok: false, error: "Missing name" };
  }

  let baseName: string;
  try {
    baseName = safeBaseName(rawName);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const resolved = await resolveDiskPath("findOriginals", baseName);
  if (!resolved) return { ok: false, error: "Soubor neexistuje" };

  const parsed = parseFindFilename(resolved.name);
  if (!parsed.ok) {
    return { ok: false, error: `Název nelze rozparsovat: ${parsed.error}` };
  }
  const findId = parsed.value.findId;

  try {
    await writeFindNoteOverride(findId, { cs, en });
  } catch (err) {
    return {
      ok: false,
      findId,
      error: `Uložení selhalo: ${(err as Error).message}`,
    };
  }

  await appendAudit({
    action: "json.update",
    ip,
    credentialLabel,
    details: {
      scope: "find-note-override",
      findId,
      hasCs: cs.trim().length > 0,
      hasEn: en.trim().length > 0,
    },
  });

  revalidatePath("/admin/files/finds");
  revalidatePath(`/admin/files/finds/${encodeURIComponent(resolved.name)}`);
  // Regenerate the public find pages (all locales) so the banner updates.
  revalidatePath("/[locale]/sbirka/[id]", "page");

  return { ok: true, findId };
}
