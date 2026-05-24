"use server";

import path from "node:path";
import { revalidatePath } from "next/cache";
import { atomicWrite } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { checkImageMagic } from "@/lib/admin/imageMagic";
import { safeJoin } from "@/lib/admin/paths";
import { resolveDiskPath } from "@/lib/admin/scopes";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { getFindPhotos, invalidateFindPhotosCache } from "@/lib/findPhotos";

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 20;

export interface UploadOneResult {
  /** Position in the formData "files" list — used by the client to
   *  match results back to the queue row that produced each one. */
  index: number;
  /** Original filename from the upload (just for the rejection
   *  messages — the file is saved under a different name). */
  originalName: string;
  /** Final on-disk name when `status === "ok"`. Used by the client
   *  to deep-link the new row at `/admin/files/donation-photos/<name>`. */
  filename?: string;
  status: "ok" | "rejected";
  reason?: string;
  size?: number;
  slot?: string;
  isAnonymized?: boolean;
}

export interface UploadResponse {
  results: UploadOneResult[];
}

/**
 * Find-detail-side upload action: takes N arbitrary files plus per-file
 * anonymize flags, and writes them as donation photos for `findId`. The
 * action assigns each new photo the next free slot letter (a, b, c, …)
 * past whatever's already on disk, so the user never has to manage the
 * slot naming themselves — they just upload + check "anonymizovat?".
 *
 * Slot assignment: the largest existing slot letter wins; the next
 * upload becomes maxExisting + 1. Non-contiguous gaps (e.g. existing
 * [a, c] because b was deleted) are NOT filled — keeps the order
 * predictable. Cap is 'z' (26 photos per find); past that the request
 * is rejected.
 *
 * Anonymized uploads land on disk as `<findId><slot>_DAR_ANON.<ext>`
 * (matches the public-side regex in findPhotos.ts — Nginx 404s those
 * filenames so unauthenticated visitors only ever get a placeholder).
 */
export async function uploadFindDonationPhotos(
  formData: FormData,
): Promise<UploadResponse> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return {
      results: [
        {
          index: 0,
          originalName: "?",
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
          originalName: "?",
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
          originalName: "?",
          status: "rejected",
          reason: `Najednou max ${MAX_FILES_PER_REQUEST} souborů`,
        },
      ],
    };
  }

  // Anon flag per file. The form posts one "anon" entry per row in
  // the SAME order as the "files" entries — "1" → anonymize, "0"
  // (or missing) → public. Missing values default to "0".
  const anonFlagsRaw = formData.getAll("anon");
  const anonFlags = files.map((_, i) =>
    typeof anonFlagsRaw[i] === "string" && anonFlagsRaw[i] === "1",
  );

  // Find the next slot letter past whatever's already on disk for
  // this find. Letters increment from 'a' (97). We never fill gaps
  // — a missing 'b' between 'a' and 'c' stays missing.
  const existingEntries = await getFindPhotos(findId);
  const lastSlot = existingEntries.reduce(
    (max, e) => (e.slot > max ? e.slot : max),
    "",
  );
  let nextSlotCode = lastSlot ? lastSlot.charCodeAt(0) + 1 : "a".charCodeAt(0);

  const results: UploadOneResult[] = [];
  let anyOk = false;
  for (let i = 0; i < files.length; i++) {
    const entry = files[i]!;
    if (!(entry instanceof File)) {
      results.push({
        index: i,
        originalName: "?",
        status: "rejected",
        reason: "Položka není soubor",
      });
      continue;
    }
    if (nextSlotCode > "z".charCodeAt(0)) {
      results.push({
        index: i,
        originalName: entry.name,
        status: "rejected",
        reason: "Limit 26 fotek na nález vyčerpán (sloty a–z)",
      });
      continue;
    }
    const slot = String.fromCharCode(nextSlotCode);
    try {
      const one = await processOne(
        entry,
        i,
        findId,
        slot,
        anonFlags[i] ?? false,
        credentialLabel,
        ip,
      );
      results.push(one);
      if (one.status === "ok") {
        anyOk = true;
        nextSlotCode += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[admin/find-donation-photos-upload] threw", {
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
            scope: "donation-photos",
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
        originalName: entry.name,
        status: "rejected",
        reason: `Server: ${message}`,
      });
    }
  }

  if (anyOk) {
    invalidateFindPhotosCache();
    revalidatePath("/admin/files/donation-photos");
    // The /admin/files/finds/<name> page caches the existing-photos
    // list via the same dirCache — bust the RSC cache so the new
    // photo appears in the card on next render.
    revalidatePath("/admin/files/finds", "layout");
    // Public listing + detail are ISR-cached for 24 h; without this a
    // visitor refreshing right after the upload would see stale state.
    // `layout` catches every locale prefix.
    revalidatePath("/sbirka", "layout");
  }
  return { results };
}

async function processOne(
  file: File,
  index: number,
  findId: number,
  slot: string,
  anonymize: boolean,
  credentialLabel: string,
  ip: string,
): Promise<UploadOneResult> {
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
      originalName,
      status: "rejected",
      reason: "Prázdný soubor",
    };
  }
  if (file.size > MAX_FILE_BYTES) {
    const reason = `Soubor je větší než ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB`;
    await audit({ ip, credentialLabel, file: originalName, reason, findId, slot });
    return { index, originalName, status: "rejected", reason };
  }

  const ext = path.extname(originalName).slice(1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    const reason = `Nepovolená přípona ".${ext}" — povolené: .jpg / .jpeg / .png / .webp`;
    await audit({ ip, credentialLabel, file: originalName, reason, findId, slot });
    return { index, originalName, status: "rejected", reason };
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
    return { index, originalName, status: "rejected", reason: magicError };
  }

  const targetName = anonymize
    ? `${findId}${slot}_DAR_ANON.${ext}`
    : `${findId}${slot}_DAR.${ext}`;

  // Defence-in-depth: the next-slot logic shouldn't collide, but if
  // a parallel upload races us we'd silently overwrite. The atomic
  // rename below uses a unique temp file, so the failure mode would
  // be a clobber, not a half-write. Cheap check before the write.
  const existing = await resolveDiskPath("donationPhotos", targetName);
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
    return { index, originalName, status: "rejected", reason };
  }

  let absolutePath: string;
  try {
    absolutePath = safeJoin("donationPhotos", targetName);
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
    return { index, originalName, status: "rejected", reason };
  }

  await atomicWrite(absolutePath, data);

  await appendAudit({
    action: "file.upload",
    ip,
    credentialLabel,
    details: {
      scope: "donation-photos",
      file: targetName,
      originalName,
      size: data.byteLength,
      findId,
      slot,
      isAnonymized: anonymize,
      viaFindDetail: true,
      outcome: "ok",
    },
  });

  return {
    index,
    originalName,
    filename: targetName,
    status: "ok",
    size: data.byteLength,
    slot,
    isAnonymized: anonymize,
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
      scope: "donation-photos",
      file: args.file,
      outcome: "rejected",
      reason: args.reason,
      findId: args.findId,
      slot: args.slot,
      viaFindDetail: true,
    },
  });
}
