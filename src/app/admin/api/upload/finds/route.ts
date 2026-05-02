import { NextResponse, type NextRequest } from "next/server";
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
  type UploadResponse,
  type UploadResult,
} from "@/app/admin/files/finds/upload-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** REST POST endpoint that accepts multipart/form-data containing
 *  one or more `files` entries and writes them under `data/finds/`.
 *
 *  This replaces the find-upload server action: client-side encoders
 *  for server actions silently choked on ~50-file batches (request
 *  never went over the wire, error surfaced as the masked production
 *  "Server Components render" wrapper). A plain fetch + native
 *  multipart sidesteps that entire pipeline — the browser streams
 *  the body without buffering everything as ArrayBuffer first.
 *
 *  Auth-gated identically: failed sessions get a 404 to avoid
 *  disclosing the endpoint to scanners. Per-file processing mirrors
 *  the server-action variant verbatim — same parser, same JPEG
 *  signature check, same atomic write, same audit rows. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/finds-upload] formData parse failed", {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json<UploadResponse>(
      { results: [], error: `Parse multipart: ${message}` },
      { status: 400 },
    );
  }

  const entries = formData.getAll("files");
  if (entries.length === 0) {
    return NextResponse.json<UploadResponse>({ results: [] });
  }
  if (entries.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json<UploadResponse>(
      {
        results: [],
        error: `Příliš mnoho souborů v dávce (max ${MAX_FILES_PER_REQUEST})`,
      },
      { status: 413 },
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
      console.error("[admin/finds-upload] processOne threw", {
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
            scope: "finds",
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

  // No revalidatePath here — the form does router.refresh() once it
  // sees an ok row. Keeping the response payload tiny so downstream
  // listing rerenders can't sink the upload.
  return NextResponse.json<UploadResponse>({ results });
}

function looksLikeJpeg(buf: Uint8Array): boolean {
  return (
    buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  );
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
