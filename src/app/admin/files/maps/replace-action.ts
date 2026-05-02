"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { atomicWrite, ensureDir, trashTimestamp } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { ADMIN_ROOTS, safeBaseName } from "@/lib/admin/paths";
import { resolveDiskPath } from "@/lib/admin/scopes";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { MAX_FILE_BYTES } from "./upload-types";

function looksLikePng(buf: Uint8Array): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

function looksLikeJpeg(buf: Uint8Array): boolean {
  return (
    buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  );
}

export interface ReplaceResult {
  ok: boolean;
  filename: string;
  size?: number;
  error?: string;
}

/** Replaces an existing map at `data/maps/<targetName>` with the
 *  uploaded bytes. The filename is taken from a hidden form field
 *  (the page renders it from the route param) — the dropped file's
 *  own name is ignored. Same magic-byte validation as the upload
 *  action; the current file is snapshotted into .trash before the
 *  atomic overwrite, so an "oops" is recoverable. */
export async function replaceMap(formData: FormData): Promise<ReplaceResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, filename: "?", error: "Unauthenticated" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const rawTarget = formData.get("target");
  if (typeof rawTarget !== "string" || rawTarget.length === 0) {
    return { ok: false, filename: "?", error: "Chybí cílový název" };
  }
  let baseName: string;
  try {
    baseName = safeBaseName(rawTarget);
  } catch (err) {
    return {
      ok: false,
      filename: rawTarget,
      error: (err as Error).message,
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return {
      ok: false,
      filename: baseName,
      error: "Chybí soubor s novými bajty",
    };
  }
  if (file.size === 0) {
    return { ok: false, filename: baseName, error: "Prázdný soubor" };
  }

  // Same NFC-aware compare as the client. We accept a mismatched
  // upload only when the form carries an explicit override flag —
  // a client can't silently slip a renamed file through, and the
  // server is the source of truth here.
  const incomingName = file.name.normalize("NFC");
  const targetNFC = baseName.normalize("NFC");
  const nameOverride = formData.get("nameOverride") === "1";
  if (incomingName !== targetNFC && !nameOverride) {
    return {
      ok: false,
      filename: baseName,
      error: `Název nového souboru ("${file.name}") se neshoduje s cílem ("${baseName}"). Pokud to je záměr, zaškrtni potvrzení a opakuj.`,
    };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      filename: baseName,
      error: `Soubor je větší než ${(MAX_FILE_BYTES / (1024 * 1024)).toFixed(0)} MB`,
    };
  }

  const arrayBuffer = await file.arrayBuffer();
  const data = Buffer.from(arrayBuffer);
  if (!looksLikePng(data) && !looksLikeJpeg(data)) {
    return {
      ok: false,
      filename: baseName,
      error: "Soubor nezačíná PNG ani JPEG signaturou",
    };
  }

  // Resolve the target through the NFC-aware lookup so the rename
  // operates on the actual on-disk name (rsync-from-macOS NFD vs
  // browser NFC drift). Reject if the target doesn't exist — the
  // replace flow is only for live maps; new uploads go through the
  // upload action.
  const existing = await resolveDiskPath("locationMaps", baseName);
  if (!existing) {
    return {
      ok: false,
      filename: baseName,
      error:
        "Cílový soubor neexistuje — nahrávání nového souboru je v upload sekci, ne v detailu.",
    };
  }

  // Snapshot the current file before overwriting. Same shape as
  // delete: data/.trash/<ts>/maps/<name>.
  const trashDir = path.join(ADMIN_ROOTS.trash, trashTimestamp(), "maps");
  await ensureDir(trashDir);
  const trashAbs = path.join(trashDir, existing.name);
  await fs.copyFile(existing.absolutePath, trashAbs);

  await atomicWrite(existing.absolutePath, data);

  await appendAudit({
    action: "file.replace",
    ip,
    credentialLabel,
    details: {
      scope: "maps",
      file: existing.name,
      size: data.byteLength,
      backupRelative: path.relative(ADMIN_ROOTS.trash, trashAbs),
    },
  });

  revalidatePath("/admin/files/maps");
  revalidatePath(`/admin/files/maps/${encodeURIComponent(existing.name)}`);
  return { ok: true, filename: existing.name, size: data.byteLength };
}
