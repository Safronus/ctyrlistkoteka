"use server";

import { promises as fs } from "node:fs";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { appendAudit } from "@/lib/admin/audit";
import { safeBaseName, safeJoin } from "@/lib/admin/paths";
import { assertMutableMapFile, isV2ReservedMapName } from "@/lib/admin/mapsV2";
import { resolveDiskPath } from "@/lib/admin/scopes";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";

// "use server" files only allow async exports — keep the prefix
// internal. The button + detail page hardcode the literal too.
const NONEXISTENT_PREFIX = "NEEXISTUJE-";

/** Strips the NEEXISTUJE- prefix — inverse of `markMapNonexistent`.
 *  Refuses when the file doesn't currently carry the prefix. The
 *  restored name has to be free; a collision means a fresh map with
 *  the original name was uploaded since the rename — refuse rather
 *  than clobber. */
export async function restoreMapNonexistent(formData: FormData): Promise<void> {
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
  if (!baseName.startsWith(NONEXISTENT_PREFIX)) {
    throw new Error("Soubor nezačíná NEEXISTUJE-");
  }
  const resolved = await resolveDiskPath("locationMaps", baseName);
  if (!resolved) {
    throw new Error("Soubor neexistuje");
  }
  const newName = resolved.name.slice(NONEXISTENT_PREFIX.length);
  if (newName.length === 0) {
    throw new Error("Po obnově by zbyl prázdný název");
  }
  const newAbs = safeJoin("locationMaps", newName);
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
      reason: "restored-nonexistent",
    },
  });

  revalidatePath("/admin/files/maps");
  redirect(`/admin/files/maps/${encodeURIComponent(newName)}`);
}

export interface RenameFileResult {
  ok: boolean;
  newFilename?: string;
  error?: string;
}

/** Generic rename action for map files — takes (oldName, newName)
 *  and renames atomically on disk after validating the new name
 *  through parseMapFilename. Sibling of `renameMapDescription`
 *  above; the difference is that THIS one accepts any new name
 *  (could change locationCode, GPS, zoom, mapId — anything that
 *  parseMapFilename still understands), whereas description-only
 *  edits use the dedicated helper for its constrained UI. Used
 *  from the detail-page generic "Upravit název" inline editor. */
export async function renameMapFile(
  formData: FormData,
): Promise<RenameFileResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, error: "Unauthenticated" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const rawOld = formData.get("oldName");
  const rawNew = formData.get("newName");
  if (typeof rawOld !== "string" || rawOld.length === 0) {
    return { ok: false, error: "Chybí oldName" };
  }
  if (typeof rawNew !== "string" || rawNew.length === 0) {
    return { ok: false, error: "Chybí newName" };
  }

  let oldBase: string;
  let newBase: string;
  try {
    oldBase = safeBaseName(rawOld);
    newBase = safeBaseName(rawNew);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (oldBase === newBase) {
    return { ok: false, error: "Nový název je stejný jako starý." };
  }
  if (isV2ReservedMapName(oldBase) || isV2ReservedMapName(newBase)) {
    return {
      ok: false,
      error:
        "Soubor patří k balíčku map verze 2 (manifest.json / Nosné mapy / Rendered mapy) — spravuje se přes /admin/import.",
    };
  }

  // The map parser is lazy-imported here so the action doesn't pay
  // the cost for unrelated maps routes (delete, anonymize, etc.).
  // Same lazy-load pattern other map actions follow.
  const { parseMapFilename } = await import("@/lib/parseFilename");
  const parsed = parseMapFilename(newBase);
  if (!parsed.ok) {
    return {
      ok: false,
      error: `Nový název nejde rozparsovat: ${parsed.error}`,
    };
  }

  const oldResolved = await resolveDiskPath("locationMaps", oldBase);
  if (!oldResolved) {
    return { ok: false, error: "Soubor neexistuje" };
  }

  let newAbs: string;
  try {
    newAbs = safeJoin("locationMaps", newBase);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  try {
    await fs.access(newAbs);
    return { ok: false, error: `Cíl "${newBase}" už v maps/ existuje.` };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  await fs.rename(oldResolved.absolutePath, newAbs);

  await appendAudit({
    action: "file.rename",
    ip,
    credentialLabel,
    details: {
      scope: "maps",
      from: oldResolved.name,
      to: newBase,
      reason: "manual-rename",
    },
  });

  revalidatePath("/admin/files/maps");
  revalidatePath(`/admin/files/maps/${encodeURIComponent(oldResolved.name)}`);
  revalidatePath(`/admin/files/maps/${encodeURIComponent(newBase)}`);
  revalidatePath("/mapa", "layout");
  return { ok: true, newFilename: newBase };
}

export interface DescriptionEditResult {
  ok: boolean;
  /** New on-disk name on success, raw old name otherwise. */
  filename: string;
  error?: string;
}

/** Renames a map by replacing segment[1] (the human description)
 *  while keeping locationCode / GPS / zoom / mapId intact. The new
 *  description must not contain `+` (it's the segment separator) and
 *  must not be empty. The rebuilt name still has to pass
 *  parseMapFilename, so the server is the source of truth here.
 *
 *  Returns a result rather than redirecting because the detail page
 *  hosts an inline editor — the client refreshes after a success
 *  rather than the server pushing a navigation. */
export async function renameMapDescription(
  formData: FormData,
): Promise<DescriptionEditResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, filename: "?", error: "Unauthenticated" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const rawName = formData.get("name");
  const rawDescription = formData.get("description");
  if (typeof rawName !== "string" || rawName.length === 0) {
    return { ok: false, filename: "?", error: "Missing name" };
  }
  if (typeof rawDescription !== "string") {
    return {
      ok: false,
      filename: rawName,
      error: "Chybí pole `description`",
    };
  }
  const newDescription = rawDescription.trim();
  if (newDescription.length === 0) {
    return {
      ok: false,
      filename: rawName,
      error: "Popisek nesmí být prázdný",
    };
  }
  if (newDescription.includes("+")) {
    return {
      ok: false,
      filename: rawName,
      error: "Popisek nesmí obsahovat znak '+'",
    };
  }
  if (newDescription.includes("/") || newDescription.includes("\\")) {
    return {
      ok: false,
      filename: rawName,
      error: "Popisek nesmí obsahovat lomítka",
    };
  }

  let baseName: string;
  try {
    baseName = safeBaseName(rawName);
  } catch (err) {
    return {
      ok: false,
      filename: rawName,
      error: (err as Error).message,
    };
  }
  if (isV2ReservedMapName(baseName)) {
    return {
      ok: false,
      filename: baseName,
      error:
        "Soubor patří k balíčku map verze 2 — popisky se v2 upravují přes /admin/import.",
    };
  }
  const resolved = await resolveDiskPath("locationMaps", baseName);
  if (!resolved) {
    return { ok: false, filename: baseName, error: "Soubor neexistuje" };
  }

  // Decompose the on-disk name. The NEEXISTUJE- prefix sits in front
  // of the canonical 6-segment basename — strip it before parsing
  // and stitch it back when rebuilding so editing zaniklé maps works
  // without an obnov step.
  const dot = resolved.name.lastIndexOf(".");
  if (dot === -1) {
    return {
      ok: false,
      filename: resolved.name,
      error: "Název nemá příponu",
    };
  }
  const stem = resolved.name.slice(0, dot);
  const ext = resolved.name.slice(dot);
  let prefix = "";
  let coreStem = stem;
  if (stem.startsWith(NONEXISTENT_PREFIX)) {
    prefix = NONEXISTENT_PREFIX;
    coreStem = stem.slice(NONEXISTENT_PREFIX.length);
  }
  const segments = coreStem.split("+");
  if (segments.length !== 6) {
    return {
      ok: false,
      filename: resolved.name,
      error: `Název nemá 6 '+'-segmentů (má ${segments.length})`,
    };
  }
  segments[1] = newDescription;
  const newName = prefix + segments.join("+") + ext;
  if (newName === resolved.name) {
    return { ok: true, filename: resolved.name };
  }

  let newAbs: string;
  try {
    newAbs = safeJoin("locationMaps", newName);
  } catch (err) {
    return {
      ok: false,
      filename: resolved.name,
      error: (err as Error).message,
    };
  }

  try {
    await fs.access(newAbs);
    return {
      ok: false,
      filename: resolved.name,
      error: `Cíl "${newName}" už existuje`,
    };
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
      reason: "description-edit",
    },
  });

  revalidatePath("/admin/files/maps");
  revalidatePath(`/admin/files/maps/${encodeURIComponent(resolved.name)}`);
  revalidatePath(`/admin/files/maps/${encodeURIComponent(newName)}`);
  return { ok: true, filename: newName };
}

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
  assertMutableMapFile(baseName);
  if (baseName.startsWith(NONEXISTENT_PREFIX)) {
    throw new Error("Soubor už má prefix NEEXISTUJE-");
  }
  const resolved = await resolveDiskPath("locationMaps", baseName);
  if (!resolved) {
    throw new Error("Soubor neexistuje");
  }
  const newName = NONEXISTENT_PREFIX + resolved.name;
  const newAbs = safeJoin("locationMaps", newName);

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
