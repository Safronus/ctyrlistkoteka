"use server";

import { atomicWrite } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { safeBaseName, safeJoin } from "@/lib/admin/paths";
import { resolveDiskPath } from "@/lib/admin/scopes";
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
import type { UploadResponse, UploadResult } from "./upload-types";

function looksLikeJpeg(buf: Uint8Array): boolean {
  return (
    buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  );
}

/** Write-to-`data/crops/` server action.
 *
 *  Crops use the same filename convention as find originals (see
 *  scripts/apply-watermark.ts) — same parser, same JPEG signature
 *  check, just a different destination root and audit scope.
 *  Hard-codes `findCrops`; the client cannot pass a scope, so a
 *  tampered request can't redirect the upload elsewhere.
 *
 *  EXIF metadata preserved byte-for-byte via atomicWrite so the
 *  watermark/sync downstream can read GPS / capture date when the
 *  crop image carries them. */
export async function uploadCrops(
  formData: FormData,
): Promise<UploadResponse> {
  // See finds/upload-action.ts for the rationale — wrap the auth +
  // session preamble so a thrown error surfaces as structured data
  // instead of the masked Next.js production wrapper.
  let credentialLabel: string;
  let ip: string;
  try {
    const session = await getAdminSession();
    if (!isAuthenticated(session)) {
      return { results: [], error: "Nepřihlášen — obnov stránku a přihlas se" };
    }
    credentialLabel = session.credentialLabel!;
    ip = await getRequestIp();
    await touchSession();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/crops-upload] auth/session preamble failed", {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return { results: [], error: `Auth/session: ${message}` };
  }

  const entries = formData.getAll("files");
  if (entries.length === 0) return { results: [] };
  if (entries.length > MAX_FILES_PER_REQUEST) {
    return {
      results: [],
      error: `Příliš mnoho souborů v dávce (max ${MAX_FILES_PER_REQUEST})`,
    };
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
      console.error("[admin/crops-upload] processOne threw", {
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
            scope: "crops",
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

  // See finds/upload-action.ts — refresh handed off to the client to
  // keep the action response payload trivial and avoid the "Server
  // Components render" wrapper when a downstream listing rerender
  // misbehaves.
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

  // Crops accept two filename forms:
  //  1. The full find-photo convention (`123+map+loc+state+anon+note.jpg`)
  //     — same as originals, parsed via parseFindFilename.
  //  2. A short ID-only form (`123.jpg`) — convenient when the user
  //     has the crop image but doesn't want to mirror every metadata
  //     edit from the original. Originals must always be in form 1;
  //     this relaxation is crop-specific.
  let findId: number;
  let ext: string;
  const parsed = parseFindFilename(baseName);
  if (parsed.ok) {
    findId = parsed.value.findId;
    ext = parsed.value.extension.toLowerCase();
  } else {
    const simple = /^(\d+)\.(jpe?g)$/i.exec(baseName);
    if (!simple) {
      return reject(
        index,
        baseName,
        `${parsed.error} (nebo akceptujeme zkrácené "<id>.jpg")`,
        ip,
        credentialLabel,
      );
    }
    findId = Number(simple[1]);
    ext = simple[2]!.toLowerCase();
  }
  if (ext !== "jpg" && ext !== "jpeg") {
    return reject(
      index,
      baseName,
      `Nepovolená přípona: ".${ext}" — povolené jsou .jpg / .jpeg`,
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
    absolutePath = safeJoin("findCrops", baseName);
  } catch (err) {
    return reject(index, baseName, (err as Error).message, ip, credentialLabel);
  }

  const existing = await resolveDiskPath("findCrops", baseName);
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
      scope: "crops",
      file: baseName,
      size: data.byteLength,
      findId,
      outcome: "ok",
    },
  });

  return {
    index,
    filename: baseName,
    status: "ok",
    size: data.byteLength,
    findId,
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
      scope: "crops",
      file: filename,
      outcome: "rejected",
      reason,
      ...extra,
    },
  });
  return { index, filename, status: "rejected", reason };
}
