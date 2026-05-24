"use server";

import path from "node:path";
import { revalidatePath } from "next/cache";
import { atomicWrite } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { checkImageMagic } from "@/lib/admin/imageMagic";
import { safeBaseName, safeJoin } from "@/lib/admin/paths";
import { resolveDiskPath } from "@/lib/admin/scopes";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { invalidateFindPhotosCache } from "@/lib/findPhotos";
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
} from "./upload-types";
import type { UploadResult } from "./upload-types";

/** Donation-photo filename pattern: `<findId><slot>_DAR[_ANON].<ext>`.
 *  Mirrors the regex in src/lib/findPhotos.ts so a successful upload
 *  is guaranteed to be picked up by the public reader. */
const FILENAME_RE = /^(\d+)([a-z])_DAR(_ANON)?\.(jpe?g|png|webp)$/i;

/** Write-to-`generated/find-photos/` server action. Hard-codes the
 *  destination root so a tampered request can't redirect the upload. */
export async function uploadDonationPhotos(
  formData: FormData,
): Promise<{ results: UploadResult[] }> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    throw new Error("Unauthenticated");
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const entries = formData.getAll("files");
  if (entries.length === 0) return { results: [] };
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
    try {
      results.push(await processOne(entry, index, credentialLabel, ip));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[admin/donation-photos-upload] processOne threw", {
        file: entry.name,
        size: entry.size,
        message,
      });
      try {
        await appendAudit({
          action: "file.upload",
          ip,
          credentialLabel,
          details: {
            scope: "donation-photos",
            file: entry.name,
            outcome: "error",
            reason: message,
          },
        });
      } catch {
        /* swallow */
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
    invalidateFindPhotosCache();
    revalidatePath("/admin/files/donation-photos");
    revalidatePath("/admin/files/finds", "layout");
    revalidatePath("/sbirka", "layout");
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
    return reject(index, baseName, "Prázdný soubor", ip, credentialLabel);
  }

  const m = FILENAME_RE.exec(baseName);
  if (!m) {
    return reject(
      index,
      baseName,
      'Název musí být ve tvaru "<id><slot>_DAR[_ANON].<jpg|jpeg|png|webp>" — např. "16330a_DAR.jpeg"',
      ip,
      credentialLabel,
    );
  }
  const findId = Number(m[1]);
  const slot = m[2]!.toLowerCase();
  const isAnonymized = m[3] !== undefined;
  const ext = path.extname(baseName).slice(1).toLowerCase();

  const arrayBuffer = await file.arrayBuffer();
  const data = Buffer.from(arrayBuffer);
  const magicError = checkImageMagic(ext, data);
  if (magicError) {
    return reject(index, baseName, magicError, ip, credentialLabel);
  }

  let absolutePath: string;
  try {
    absolutePath = safeJoin("donationPhotos", baseName);
  } catch (err) {
    return reject(index, baseName, (err as Error).message, ip, credentialLabel);
  }

  const existing = await resolveDiskPath("donationPhotos", baseName);
  if (existing) {
    return reject(
      index,
      baseName,
      `Soubor s tímto jménem už existuje (na disku jako "${existing.name}", replace zatím není podporován)`,
      ip,
      credentialLabel,
    );
  }

  await atomicWrite(absolutePath, data);

  await appendAudit({
    action: "file.upload",
    ip,
    credentialLabel,
    details: {
      scope: "donation-photos",
      file: baseName,
      size: data.byteLength,
      findId,
      slot,
      isAnonymized,
      outcome: "ok",
    },
  });

  return {
    index,
    filename: baseName,
    status: "ok",
    size: data.byteLength,
    findId,
    slot,
    isAnonymized,
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
      scope: "donation-photos",
      file: filename,
      outcome: "rejected",
      reason,
      ...extra,
    },
  });
  return { index, filename, status: "rejected", reason };
}
