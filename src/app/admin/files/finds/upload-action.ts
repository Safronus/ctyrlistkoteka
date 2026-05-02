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
): Promise<UploadResponse> {
  // Wrap the entire body so any uncaught throw — auth check, cookie
  // refresh, the post-success revalidatePath rerender — surfaces as
  // a structured `error` instead of Next.js's masked production
  // "Server Components render" wrapper. Without this the user only
  // sees the generic message and we can't tell from logs vs UI which
  // step failed.
  let credentialLabel: string;
  let ip: string;
  try {
    const session = await getAdminSession();
    if (!isAuthenticated(session)) {
      return { results: [], error: "Nepřihlášen — obnov stránku a přihlas se" };
    }
    credentialLabel = session.credentialLabel!;
    ip = await getRequestIp();
    // Refresh sliding TTL — server actions are the canonical place for
    // this since cookie writes are forbidden in plain server components.
    await touchSession();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/finds-upload] auth/session preamble failed", {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return { results: [], error: `Auth/session: ${message}` };
  }

  const entries = formData.getAll("files");
  if (entries.length === 0) {
    return { results: [] };
  }
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

  // Cache invalidation moved to the client (router.refresh() in the
  // upload form on success). The server-side revalidatePath bundles
  // the rerendered tree into the action response — and any throw
  // during that rerender (a transient listing-page error after a big
  // batch lands) is what surfaces to the client as the masked
  // production "Server Components render" wrapper. Letting the client
  // drive the refresh keeps the action response trivially small; if
  // the listing then fails to render, error.tsx catches it
  // independently.
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

  // Unicode-aware existence check. Byte-exact fs.access misses NFD
  // (rsync from macOS) vs NFC (browser-normalised) collisions and
  // would silently produce duplicates with the same visible name.
  const existing = await resolveDiskPath("findOriginals", baseName);
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
