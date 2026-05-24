"use server";

import path from "node:path";
import { revalidatePath } from "next/cache";
import { atomicWrite, ensureDir } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { checkImageMagic } from "@/lib/admin/imageMagic";
import { ADMIN_ROOTS, safeJoin } from "@/lib/admin/paths";
import { resolveDiskPath } from "@/lib/admin/scopes";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import {
  getFindFreePhotos,
  invalidateFindFreePhotosCache,
} from "@/lib/findFreePhotos";
import {
  CONVERT_BYTE_THRESHOLD,
  CONVERT_LONG_SIDE_PX,
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
  MAX_LONG_PX,
  type UploadResult,
  WEBP_QUALITY,
} from "../free-photos/upload-types";

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

export interface UploadResponse {
  results: UploadResult[];
}

/**
 * Find-detail-side upload action for "free" photos — extra snapshots
 * with no donation context, always public. Mirrors the donation-photo
 * action with three differences:
 *   1. No `_ANON` variant (the file lives publicly or doesn't live).
 *   2. Server-side downscale: inputs larger than CONVERT_BYTE_THRESHOLD
 *      bytes OR with a long side past CONVERT_LONG_SIDE_PX get
 *      re-encoded to WebP @ WEBP_QUALITY, fitted to MAX_LONG_PX.
 *   3. Writes to `generated/find-free-photos/`, not `find-photos/`.
 *
 * Slot assignment: next free letter past whatever's already on disk
 * for this find. `a`..`z` cap = 26 photos / find; past that the row is
 * rejected (matches the donation card's cap so the UX is consistent).
 */
export async function uploadFindFreePhotos(
  formData: FormData,
): Promise<UploadResponse> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return {
      results: [
        {
          index: 0,
          filename: "?",
          status: "rejected",
          reason: "Unauthenticated",
        },
      ],
    };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const findIdRaw = formData.get("findId");
  if (typeof findIdRaw !== "string" || !/^\d+$/.test(findIdRaw)) {
    return {
      results: [
        {
          index: 0,
          filename: "?",
          status: "rejected",
          reason: "Chybí nebo neplatný findId",
        },
      ],
    };
  }
  const findId = Number(findIdRaw);

  const files = formData.getAll("files");
  if (files.length === 0) return { results: [] };
  if (files.length > MAX_FILES_PER_REQUEST) {
    return {
      results: [
        {
          index: 0,
          filename: "?",
          status: "rejected",
          reason: `Najednou max ${MAX_FILES_PER_REQUEST} souborů`,
        },
      ],
    };
  }

  // Ensure the target directory exists. The atomic write below uses a
  // sibling tempfile that lives in the same dir, so without this the
  // very first upload to a fresh install would ENOENT on the open().
  await ensureDir(ADMIN_ROOTS.freePhotos);

  const existingEntries = await getFindFreePhotos(findId);
  const lastSlot = existingEntries.reduce(
    (max, e) => (e.slot > max ? e.slot : max),
    "",
  );
  let nextSlotCode = lastSlot ? lastSlot.charCodeAt(0) + 1 : "a".charCodeAt(0);

  const results: UploadResult[] = [];
  let anyOk = false;
  for (let i = 0; i < files.length; i++) {
    const entry = files[i]!;
    if (!(entry instanceof File)) {
      results.push({
        index: i,
        filename: "?",
        status: "rejected",
        reason: "Položka není soubor",
      });
      continue;
    }
    if (nextSlotCode > "z".charCodeAt(0)) {
      results.push({
        index: i,
        filename: entry.name,
        status: "rejected",
        reason: "Limit 26 fotek na nález vyčerpán (sloty a–z)",
      });
      continue;
    }
    const slot = String.fromCharCode(nextSlotCode);
    try {
      const one = await processOne(entry, i, findId, slot, credentialLabel, ip);
      results.push(one);
      if (one.status === "ok") {
        anyOk = true;
        nextSlotCode += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[admin/find-free-photos-upload] threw", {
        findId,
        slot,
        file: entry.name,
        message,
      });
      try {
        await appendAudit({
          action: "file.upload",
          ip,
          credentialLabel,
          details: {
            scope: "free-photos",
            file: entry.name,
            outcome: "error",
            reason: message,
            findId,
            slot,
            viaFindDetail: true,
          },
        });
      } catch {
        /* swallow */
      }
      results.push({
        index: i,
        filename: entry.name,
        status: "rejected",
        reason: `Server: ${message}`,
      });
    }
  }

  if (anyOk) {
    invalidateFindFreePhotosCache();
    revalidatePath("/admin/files/free-photos");
    revalidatePath("/admin/files/finds", "layout");
  }
  return { results };
}

async function processOne(
  file: File,
  index: number,
  findId: number,
  slot: string,
  credentialLabel: string,
  ip: string,
): Promise<UploadResult> {
  const originalName = file.name;

  if (file.size === 0) {
    await audit({
      ip,
      credentialLabel,
      file: originalName,
      reason: "Prázdný soubor",
      findId,
      slot,
    });
    return {
      index,
      filename: originalName,
      status: "rejected",
      reason: "Prázdný soubor",
    };
  }
  if (file.size > MAX_FILE_BYTES) {
    const reason = `Soubor je větší než ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB`;
    await audit({ ip, credentialLabel, file: originalName, reason, findId, slot });
    return { index, filename: originalName, status: "rejected", reason };
  }

  const ext = path.extname(originalName).slice(1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    const reason = `Nepovolená přípona ".${ext}" — povolené: .jpg / .jpeg / .png / .webp`;
    await audit({ ip, credentialLabel, file: originalName, reason, findId, slot });
    return { index, filename: originalName, status: "rejected", reason };
  }

  const arrayBuffer = await file.arrayBuffer();
  const data = Buffer.from(arrayBuffer);
  const magicError = checkImageMagic(ext, data);
  if (magicError) {
    await audit({
      ip,
      credentialLabel,
      file: originalName,
      reason: magicError,
      findId,
      slot,
    });
    return { index, filename: originalName, status: "rejected", reason: magicError };
  }

  // Decide whether to re-encode. The pixel-side check requires
  // decoding metadata, which sharp does cheaply (header-only read).
  // If it fails (corrupt header, format we don't understand) we fall
  // back to size-only — the magic check above already gated by ext.
  let needsResize = false;
  let metaWidth: number | null = null;
  let metaHeight: number | null = null;
  try {
    const sharpModule = await import("sharp");
    const sharpLib = sharpModule.default;
    const meta = await sharpLib(data, { failOn: "none" }).metadata();
    if (typeof meta.width === "number") metaWidth = meta.width;
    if (typeof meta.height === "number") metaHeight = meta.height;
    if (metaWidth && metaHeight) {
      const longest = Math.max(metaWidth, metaHeight);
      if (longest > CONVERT_LONG_SIDE_PX) needsResize = true;
    }
  } catch (err) {
    console.warn(
      "[admin/find-free-photos-upload] sharp metadata probe failed; falling back to size-only conversion gate",
      { findId, slot, file: originalName, err: (err as Error).message },
    );
  }

  const tooBig = file.size > CONVERT_BYTE_THRESHOLD;
  const shouldConvert = tooBig || needsResize;

  let outBuffer: Buffer;
  let outExt: string;
  let converted = false;
  if (shouldConvert) {
    const sharpModule = await import("sharp");
    const sharpLib = sharpModule.default;
    // `failOn: "none"` keeps sharp from refusing slightly malformed
    // JPEGs that browsers happily decode. `withMetadata({})` strips
    // EXIF — these photos are public and we don't want GPS leaking.
    outBuffer = await sharpLib(data, { failOn: "none" })
      .rotate()
      .resize({
        width: MAX_LONG_PX,
        height: MAX_LONG_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    outExt = "webp";
    converted = true;
  } else {
    outBuffer = data;
    outExt = ext === "jpg" ? "jpeg" : ext;
  }

  const targetName = `${findId}${slot}_FOTO.${outExt}`;

  const existing = await resolveDiskPath("freePhotos", targetName);
  if (existing) {
    const reason = `Soubor "${targetName}" už existuje (race?). Zkus znovu.`;
    await audit({
      ip,
      credentialLabel,
      file: originalName,
      reason,
      findId,
      slot,
    });
    return { index, filename: originalName, status: "rejected", reason };
  }

  let absolutePath: string;
  try {
    absolutePath = safeJoin("freePhotos", targetName);
  } catch (err) {
    const reason = (err as Error).message;
    await audit({
      ip,
      credentialLabel,
      file: originalName,
      reason,
      findId,
      slot,
    });
    return { index, filename: originalName, status: "rejected", reason };
  }

  await atomicWrite(absolutePath, outBuffer);

  await appendAudit({
    action: "file.upload",
    ip,
    credentialLabel,
    details: {
      scope: "free-photos",
      file: targetName,
      originalName,
      sourceSize: data.byteLength,
      size: outBuffer.byteLength,
      converted,
      findId,
      slot,
      viaFindDetail: true,
      outcome: "ok",
    },
  });

  return {
    index,
    filename: targetName,
    status: "ok",
    size: outBuffer.byteLength,
    findId,
    slot,
    converted,
  };
}

async function audit(args: {
  ip: string;
  credentialLabel: string;
  file: string;
  reason: string;
  findId: number;
  slot: string;
}): Promise<void> {
  await appendAudit({
    action: "file.upload",
    ip: args.ip,
    credentialLabel: args.credentialLabel,
    details: {
      scope: "free-photos",
      file: args.file,
      outcome: "rejected",
      reason: args.reason,
      findId: args.findId,
      slot: args.slot,
      viaFindDetail: true,
    },
  });
}
