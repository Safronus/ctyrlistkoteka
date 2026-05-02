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
import { invalidateLocationPhotosCache } from "@/lib/locationPhotos";
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
} from "./upload-types";
import type { UploadResult } from "./upload-types";

/** Location-photo filename pattern, mirroring locationPhotos.ts:
 *  `<mapBaseName>_reálné foto<descriptor>.<ext>`. The descriptor is
 *  free-form (and may be empty) — the loader only requires the
 *  `_reálné foto` substring at position > 0 plus an allowed ext. */
const PHOTO_SUFFIX_PREFIX = "_reálné foto";
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

/** Write-to-`generated/location-photos/` server action. */
export async function uploadLocationPhotos(
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
      console.error("[admin/location-photos-upload] processOne threw", {
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
            scope: "location-photos",
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
    invalidateLocationPhotosCache();
    revalidatePath("/admin/files/location-photos");
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

  const ext = path.extname(baseName).slice(1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return reject(
      index,
      baseName,
      `Nepovolená přípona: ".${ext}" — povolené jsou .jpg / .jpeg / .png / .webp`,
      ip,
      credentialLabel,
    );
  }

  const noExt = baseName.slice(0, baseName.length - (ext.length + 1));
  const normalized = noExt.normalize("NFC");
  const suffixIdx = normalized.indexOf(PHOTO_SUFFIX_PREFIX);
  if (suffixIdx <= 0) {
    return reject(
      index,
      baseName,
      `Název musí obsahovat "${PHOTO_SUFFIX_PREFIX}" za prefixem mapy — např. "Reykjavík_reálné foto.png"`,
      ip,
      credentialLabel,
    );
  }
  const mapBaseName = normalized.slice(0, suffixIdx);

  const arrayBuffer = await file.arrayBuffer();
  const data = Buffer.from(arrayBuffer);
  const magicError = checkImageMagic(ext, data);
  if (magicError) {
    return reject(index, baseName, magicError, ip, credentialLabel);
  }

  let absolutePath: string;
  try {
    absolutePath = safeJoin("locationPhotos", baseName);
  } catch (err) {
    return reject(index, baseName, (err as Error).message, ip, credentialLabel);
  }

  const existing = await resolveDiskPath("locationPhotos", baseName);
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
      scope: "location-photos",
      file: baseName,
      size: data.byteLength,
      mapBaseName,
      outcome: "ok",
    },
  });

  return {
    index,
    filename: baseName,
    status: "ok",
    size: data.byteLength,
    mapBaseName,
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
      scope: "location-photos",
      file: filename,
      outcome: "rejected",
      reason,
      ...extra,
    },
  });
  return { index, filename, status: "rejected", reason };
}
