"use server";

import { promises as fs } from "node:fs";
import { revalidatePath } from "next/cache";
import { atomicWrite } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { safeBaseName, safeJoin } from "@/lib/admin/paths";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { parseFindFilename } from "@/lib/parseFilename";
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
} from "./upload-types";
import type { UploadResult } from "./upload-types";

// JPEG SOI marker is the first three bytes: 0xFF 0xD8 0xFF (followed by
// any APP marker). We deliberately do not look any further — the rest
// of the file (including all EXIF, GPS, datetime, ICC) must reach disk
// byte-exact. Re-encoding via sharp/heic-convert would strip the
// metadata that sync.ts needs for GPS + capture date.
function looksLikeJpeg(buf: Uint8Array): boolean {
  return (
    buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  );
}

/** Write-to-`data/finds/` server action.
 *
 *  Hard-codes the destination root (`findOriginals`) — no scope param
 *  comes from the client, so even a tampered request can't redirect
 *  the upload into another whitelisted root, let alone outside.
 *
 *  Validates in this order: filename sanitisation → size cap →
 *  parseFindFilename → extension whitelist → JPEG magic bytes →
 *  destination resolution → existence check → atomic write. Each
 *  rejection is audited with its reason. Successful writes preserve
 *  the file byte-for-byte (no re-encode), so EXIF/GPS/datetime survive
 *  intact for the sync importer downstream. */
export async function uploadFinds(
  formData: FormData,
): Promise<{ results: UploadResult[] }> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    throw new Error("Unauthenticated");
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  // Refresh sliding TTL — server actions are the canonical place for
  // this since cookie writes are forbidden in plain server components.
  await touchSession();

  const entries = formData.getAll("files");
  if (entries.length === 0) {
    return { results: [] };
  }
  if (entries.length > MAX_FILES_PER_REQUEST) {
    throw new Error(
      `Too many files in one request (max ${MAX_FILES_PER_REQUEST})`,
    );
  }

  const results: UploadResult[] = [];
  for (const entry of entries) {
    const index = results.length;
    if (!(entry instanceof File)) {
      results.push({
        index,
        filename: "?",
        status: "rejected",
        reason: "Položka není soubor",
      });
      continue;
    }
    // Per-file try/catch turns any unexpected error (atomic write
    // failure, audit append fault, etc.) into a rejected result row
    // rather than letting it tear down the whole action and force
    // the client into Next.js's generic "unexpected response" path.
    try {
      results.push(await processOne(entry, index, credentialLabel, ip));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[admin/upload] processOne threw", {
        file: entry.name,
        size: entry.size,
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      // Fire a best-effort audit row so the failure is visible in the
      // /admin/audit view too.
      try {
        await appendAudit({
          action: "file.upload",
          ip,
          credentialLabel,
          details: {
            scope: "finds",
            file: entry.name,
            outcome: "error",
            reason: message,
          },
        });
      } catch {
        // appendAudit already swallows its own errors; this catch is
        // belt-and-braces in case the import path itself blew up.
      }
      results.push({
        index,
        filename: entry.name,
        status: "rejected",
        reason: `Server: ${message}`,
      });
    }
  }

  if (results.some((r) => r.status === "ok")) {
    revalidatePath("/admin/files/finds");
  }
  return { results };
}

async function processOne(
  file: File,
  index: number,
  credentialLabel: string,
  ip: string,
): Promise<UploadResult> {
  const rawName = file.name;

  let baseName: string;
  try {
    baseName = safeBaseName(rawName);
  } catch (err) {
    return reject(index, rawName, (err as Error).message, ip, credentialLabel);
  }

  if (file.size > MAX_FILE_BYTES) {
    return reject(
      index,
      baseName,
      `Soubor je větší než ${(MAX_FILE_BYTES / (1024 * 1024)).toFixed(0)} MB`,
      ip,
      credentialLabel,
      { size: file.size },
    );
  }
  if (file.size === 0) {
    return reject(
      index,
      baseName,
      "Prázdný soubor",
      ip,
      credentialLabel,
    );
  }

  const parsed = parseFindFilename(baseName);
  if (!parsed.ok) {
    return reject(index, baseName, parsed.error, ip, credentialLabel);
  }
  const ext = parsed.value.extension.toLowerCase();
  if (ext !== "jpg" && ext !== "jpeg") {
    return reject(
      index,
      baseName,
      `Nepovolená přípona: ".${parsed.value.extension}" — povolené jsou .jpg / .jpeg`,
      ip,
      credentialLabel,
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const data = Buffer.from(arrayBuffer);
  if (!looksLikeJpeg(data)) {
    return reject(
      index,
      baseName,
      "Soubor nezačíná JPEG signaturou (FF D8 FF)",
      ip,
      credentialLabel,
    );
  }
  // Belt-and-braces: the cap was already enforced via `file.size` but
  // a buggy multipart parser could in theory disagree with the
  // declared size. Re-check on the actual buffer length.
  if (data.byteLength > MAX_FILE_BYTES) {
    return reject(
      index,
      baseName,
      `Soubor je větší než ${(MAX_FILE_BYTES / (1024 * 1024)).toFixed(0)} MB`,
      ip,
      credentialLabel,
      { size: data.byteLength },
    );
  }

  let absolutePath: string;
  try {
    absolutePath = safeJoin("findOriginals", baseName);
  } catch (err) {
    return reject(index, baseName, (err as Error).message, ip, credentialLabel);
  }

  // Existence check — the upload action is intentionally NOT a
  // replace. Replacing an existing find photo is a separate flow
  // (phase 4+) that copies the original to data/.trash/<ts>/ first.
  try {
    await fs.access(absolutePath);
    return reject(
      index,
      baseName,
      "Soubor s tímto jménem už existuje (replace zatím není podporován)",
      ip,
      credentialLabel,
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  await atomicWrite(absolutePath, data);

  await appendAudit({
    action: "file.upload",
    ip,
    credentialLabel,
    details: {
      scope: "finds",
      file: baseName,
      size: data.byteLength,
      findId: parsed.value.findId,
      outcome: "ok",
    },
  });

  return {
    index,
    filename: baseName,
    status: "ok",
    size: data.byteLength,
    findId: parsed.value.findId,
  };
}

async function reject(
  index: number,
  filename: string,
  reason: string,
  ip: string,
  credentialLabel: string,
  extra: Record<string, unknown> = {},
): Promise<UploadResult> {
  await appendAudit({
    action: "file.upload",
    ip,
    credentialLabel,
    details: {
      scope: "finds",
      file: filename,
      outcome: "rejected",
      reason,
      ...extra,
    },
  });
  return { index, filename, status: "rejected", reason };
}
