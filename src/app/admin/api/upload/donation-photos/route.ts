import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { atomicWrite } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { checkImageMagic } from "@/lib/admin/imageMagic";
import {
  drainRequestBody,
  parseMultipartRequest,
  type MultipartFile,
} from "@/lib/admin/multipart";
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
  type UploadResponse,
  type UploadResult,
} from "@/app/admin/files/donation-photos/upload-types";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Donation-photo filename pattern: `<findId><slot>_DAR[_ANON].<ext>`.
 *  Mirrors src/lib/findPhotos.ts so a successful upload is guaranteed
 *  to be picked up by the public reader. */
const FILENAME_RE = /^(\d+)([a-z])_DAR(_ANON)?\.(jpe?g|png|webp)$/i;

/** REST POST endpoint that accepts multipart/form-data with one or
 *  more `files` parts and writes them under `generated/find-photos/`.
 *
 *  Body parsing goes through busboy (`@/lib/admin/multipart`) — same
 *  reason as the finds upload route: Next.js's server-action RSC
 *  encoder buffers the whole multipart body into a single in-memory
 *  payload, which choked on 20+ files × 5–10 MB and surfaced as the
 *  generic "An error occurred in the Server Components render" with
 *  no usable detail. Native streaming multipart handles the same
 *  batch sizes without complaint. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Outer guard — mirrors finds route. Anything that escapes
  // handleUpload becomes a structured UploadResponse with the error
  // surfaced to the client instead of Next.js's HTML 500 page.
  try {
    return await handleUpload(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[admin/donation-photos-upload] handler escaped", {
      message,
      stack,
    });
    return NextResponse.json<UploadResponse>(
      {
        results: [],
        error: stack
          ? `Server crash: ${message}\n${stack}`
          : `Server crash: ${message}`,
      },
      { status: 500 },
    );
  }
}

async function handleUpload(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    // Drain the (possibly large) upload body before answering so a
    // mid-upload POST gets a clean 404 instead of a reset connection —
    // an expired admin session was otherwise surfacing as "Load failed".
    await drainRequestBody(request);
    return new NextResponse("Not found", { status: 404 });
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  let parsed;
  try {
    parsed = await parseMultipartRequest(request, {
      maxFileSize: MAX_FILE_BYTES + 1, // +1 so caller can detect truncation
      maxFiles: MAX_FILES_PER_REQUEST,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/donation-photos-upload] multipart parse failed", {
      contentType: request.headers.get("content-type"),
      contentLength: request.headers.get("content-length"),
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json<UploadResponse>(
      { results: [], error: `Parse multipart: ${message}` },
      { status: 400 },
    );
  }

  const fileEntries = parsed.files.filter((f) => f.fieldName === "files");
  if (fileEntries.length === 0) {
    return NextResponse.json<UploadResponse>({ results: [] });
  }
  if (fileEntries.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json<UploadResponse>(
      {
        results: [],
        error: `Příliš mnoho souborů v dávce (max ${MAX_FILES_PER_REQUEST})`,
      },
      { status: 413 },
    );
  }

  const results: UploadResult[] = [];
  for (const entry of fileEntries) {
    const index = results.length;
    try {
      results.push(await processOne(entry, index, credentialLabel, ip));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[admin/donation-photos-upload] processOne threw", {
        file: entry.filename,
        size: entry.data.byteLength,
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      try {
        await appendAudit({
          action: "file.upload",
          ip,
          credentialLabel,
          details: {
            scope: "donation-photos",
            file: entry.filename,
            outcome: "error",
            reason: message,
          },
        });
      } catch {
        /* swallow */
      }
      results.push({
        index,
        filename: entry.filename,
        status: "rejected",
        reason: `Server: ${message}`,
      });
    }
  }

  // Same cache-invalidation pattern as the previous server action.
  // Public ISR + admin RSC cache need to drop their cached views so
  // the new photos render on the next request, not 24 h later.
  if (results.some((r) => r.status === "ok")) {
    invalidateFindPhotosCache();
    revalidatePath("/admin/files/donation-photos");
    revalidatePath("/admin/files/finds", "layout");
    revalidatePath("/sbirka", "layout");
  }

  return NextResponse.json<UploadResponse>({ results });
}

async function processOne(
  file: MultipartFile,
  index: number,
  credentialLabel: string,
  ip: string,
): Promise<UploadResult> {
  const rawName = file.filename;

  let baseName: string;
  try {
    baseName = safeBaseName(rawName);
  } catch (err) {
    return reject(index, rawName, (err as Error).message, ip, credentialLabel);
  }

  const data = file.data;
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
  if (data.byteLength === 0) {
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
