import { NextResponse, type NextRequest } from "next/server";
import { atomicWrite } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { readExifSafe } from "@/lib/admin/exif";
import { parseMultipartRequest, type MultipartFile } from "@/lib/admin/multipart";
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
  type UploadResponse,
  type UploadResult,
} from "@/app/admin/files/finds/upload-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** REST POST endpoint that accepts multipart/form-data with one or
 *  more `files` parts and writes them under `data/finds/`.
 *
 *  Body parsing goes through busboy (`@/lib/admin/multipart`) instead
 *  of `request.formData()` — the undici-backed default silently
 *  failed with "Failed to parse body as FormData" on Safari + 50-file
 *  batches on macOS, even though the request reached the server fine.
 *  busboy handles the same batches without complaint and gives us per-
 *  part info (filename + mimetype) directly. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
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
    console.error("[admin/finds-upload] multipart parse failed", {
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
      console.error("[admin/finds-upload] processOne threw", {
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
            scope: "finds",
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

  // No revalidatePath — the form does router.refresh() once it sees
  // an ok row. Keeping this response payload tiny so listing
  // rerenders can't sink the upload.
  return NextResponse.json<UploadResponse>({ results });
}

function looksLikeJpeg(buf: Uint8Array): boolean {
  return (
    buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  );
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

  if (!looksLikeJpeg(data)) {
    return reject(
      index,
      baseName,
      "Soubor nezačíná JPEG signaturou (FF D8 FF)",
      ip,
      credentialLabel,
    );
  }

  let absolutePath: string;
  try {
    absolutePath = safeJoin("findOriginals", baseName);
  } catch (err) {
    return reject(index, baseName, (err as Error).message, ip, credentialLabel);
  }

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

  // Inspect EXIF immediately after the file lands on disk. Gives the
  // operator a pre-sync warning if DateTimeOriginal is missing —
  // sync would otherwise write `Find.foundAt = null` later and the
  // find would silently drop out of every time-based aggregate. The
  // helper never throws (returns nulls on malformed EXIF) so a bad
  // EXIF block doesn't break the upload itself.
  const exif = await readExifSafe(absolutePath);
  const exifWarning =
    exif.dateTaken === null
      ? "Chybí EXIF DateTimeOriginal — sync uloží foundAt = null a nález vypadne z časových agregátů."
      : !exif.dateTakenHasClock
        ? "EXIF má datum, ale chybí čas (HH:MM:SS = 00:00:00) — sync ho přiřadí na půlnoc."
        : undefined;

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
      exifDateTaken: exif.dateTaken?.toISOString() ?? null,
      exifWarning: exifWarning ?? null,
    },
  });

  return {
    index,
    filename: baseName,
    status: "ok",
    size: data.byteLength,
    findId: parsed.value.findId,
    ...(exifWarning ? { exifWarning } : {}),
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
