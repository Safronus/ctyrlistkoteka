import { NextResponse, type NextRequest } from "next/server";
import { atomicWrite } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { readExifSafe } from "@/lib/admin/exif";
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
import { parseFindFilename } from "@/lib/parseFilename";
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
  type UploadResponse,
  type UploadResult,
} from "@/app/admin/files/crops/upload-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** REST POST endpoint for crop uploads — see finds/route.ts for the
 *  rationale (busboy instead of `request.formData()`). Crops accept
 *  the full 6-segment filename convention OR the short `<id>.jpg`
 *  shortcut, otherwise identical to the finds variant. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Outer guard — see finds/route.ts for rationale. Catches handler
  // escapes and returns a structured UploadResponse with the stack
  // so the client's "Zkopírovat chybový log" button has something
  // actionable to forward.
  try {
    return await handleUpload(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[admin/crops-upload] handler escaped", { message, stack });
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
      maxFileSize: MAX_FILE_BYTES + 1,
      maxFiles: MAX_FILES_PER_REQUEST,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/crops-upload] multipart parse failed", {
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
      console.error("[admin/crops-upload] processOne threw", {
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
            scope: "crops",
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

  // Crops accept the full 6-segment convention OR the short `<id>.jpg`
  // form (per scripts/apply-watermark.ts).
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

  // Inspect EXIF on the crop too — softer warning than for originals
  // because the cropping pipeline routinely strips DateTimeOriginal,
  // and sync only writes `Find.foundAt` from the ORIGINAL's EXIF, not
  // the crop's. So a crop with missing EXIF is fine *as long as the
  // matching original has EXIF*. We still surface the warning so the
  // operator can confirm the original is healthy before sync.
  const exif = await readExifSafe(absolutePath);
  const exifWarning =
    exif.dateTaken === null
      ? "Ořez nemá EXIF DateTimeOriginal — sync se opírá o EXIF originálu pro #" +
        findId +
        "; ověř, že originál EXIF má."
      : !exif.dateTakenHasClock
        ? "EXIF má datum, ale chybí čas (HH:MM:SS = 00:00:00) — pokud originál má plný timestamp, nevadí."
        : undefined;

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
      exifDateTaken: exif.dateTaken?.toISOString() ?? null,
      exifWarning: exifWarning ?? null,
    },
  });

  return {
    index,
    filename: baseName,
    status: "ok",
    size: data.byteLength,
    findId,
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
      scope: "crops",
      file: filename,
      outcome: "rejected",
      reason,
      ...extra,
    },
  });
  return { index, filename, status: "rejected", reason };
}
