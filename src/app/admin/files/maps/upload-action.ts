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
import { parseMapFilename } from "@/lib/parseFilename";
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
} from "./upload-types";
import type { UploadResult } from "./upload-types";

// PNG signature is 8 bytes. CLAUDE.md notes the maps may be JPEG
// bytes wearing a .png extension (legacy from some Map Marker
// exports), so we treat either signature as valid binary content.
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

/** Write-to-`data/maps/` server action.
 *
 *  Hard-codes the destination root (`locationMaps`); the client
 *  cannot pass a scope, so a tampered request can't redirect the
 *  upload elsewhere.
 *
 *  Validation: filename sanitisation → size cap →
 *  parseMapFilename → extension whitelist (.png) → magic bytes
 *  (PNG or JPEG, per CLAUDE.md) → destination resolution →
 *  no-overwrite check → atomic write. EXIF/AOI_POLYGON metadata
 *  are preserved byte-for-byte for sync.ts. */
export async function uploadMaps(
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
    try {
      results.push(await processOne(entry, index, credentialLabel, ip));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[admin/maps-upload] processOne threw", {
        file: entry.name,
        size: entry.size,
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      try {
        await appendAudit({
          action: "file.upload",
          ip,
          credentialLabel,
          details: {
            scope: "maps",
            file: entry.name,
            outcome: "error",
            reason: message,
          },
        });
      } catch {
        /* appendAudit already swallows its own errors; belt-and-braces. */
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
    revalidatePath("/admin/files/maps");
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

  const parsed = parseMapFilename(baseName);
  if (!parsed.ok) {
    return reject(index, baseName, parsed.error, ip, credentialLabel);
  }
  const ext = parsed.value.extension.toLowerCase();
  if (ext !== "png") {
    return reject(
      index,
      baseName,
      `Nepovolená přípona: ".${parsed.value.extension}" — povolené je jen .png`,
      ip,
      credentialLabel,
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const data = Buffer.from(arrayBuffer);
  if (!looksLikePng(data) && !looksLikeJpeg(data)) {
    return reject(
      index,
      baseName,
      "Soubor nezačíná PNG ani JPEG signaturou",
      ip,
      credentialLabel,
    );
  }
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
    absolutePath = safeJoin("locationMaps", baseName);
  } catch (err) {
    return reject(index, baseName, (err as Error).message, ip, credentialLabel);
  }

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
      scope: "maps",
      file: baseName,
      size: data.byteLength,
      mapId: parsed.value.mapId,
      locationCode: parsed.value.locationCode,
      outcome: "ok",
    },
  });

  return {
    index,
    filename: baseName,
    status: "ok",
    size: data.byteLength,
    mapId: parsed.value.mapId,
    locationCode: parsed.value.locationCode,
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
      scope: "maps",
      file: filename,
      outcome: "rejected",
      reason,
      ...extra,
    },
  });
  return { index, filename, status: "rejected", reason };
}
