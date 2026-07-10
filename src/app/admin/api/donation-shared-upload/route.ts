import { NextResponse, type NextRequest } from "next/server";
import { appendAudit } from "@/lib/admin/audit";
import {
  drainRequestBody,
  parseMultipartRequest,
  type MultipartFile,
} from "@/lib/admin/multipart";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { normalizeToWebp } from "@/lib/images";
import { writeStagedPhoto } from "@/lib/donationShares";
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
  type SharedUploadResponse,
  type SharedUploadResult,
} from "@/app/admin/files/donation-photos/upload-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step 1 of the bulk shared-photo flow: normalize uploaded photos to WebP and
 * park them in the non-served staging dir (keyed by sha1). Multipart, meant
 * to be called in small (≤ MAX_BATCH_BYTES) chunks by the client so a big
 * total can't hit the ~10 MB body-truncation cap. Returns each photo's sha1;
 * the client collects them in order and calls /donation-bulk-assign (JSON) to
 * commit the actual find links. Nothing is served or assigned here.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    return await handle(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/donation-shared-upload] handler escaped", {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json<SharedUploadResponse>(
      { results: [], error: `Server crash: ${message}` },
      { status: 500 },
    );
  }
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
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
    return NextResponse.json<SharedUploadResponse>(
      { results: [], error: `Zpracování nahrávky selhalo: ${message}` },
      { status: 400 },
    );
  }

  const files = parsed.files.filter((f) => f.fieldName === "files");
  const results: SharedUploadResult[] = [];
  for (const file of files) {
    results.push(await processOne(file, results.length));
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  if (okCount > 0) {
    await appendAudit({
      action: "file.upload",
      ip,
      credentialLabel,
      details: { scope: "donation-shared-staging", staged: okCount },
    });
  }
  return NextResponse.json<SharedUploadResponse>({ results });
}

async function processOne(
  file: MultipartFile,
  index: number,
): Promise<SharedUploadResult> {
  const filename = file.filename || `(bez názvu ${index + 1})`;
  if (file.data.byteLength === 0)
    return { index, filename, status: "rejected", reason: "Prázdný soubor" };
  if (file.data.byteLength > MAX_FILE_BYTES)
    return {
      index,
      filename,
      status: "rejected",
      reason: `Větší než ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB`,
    };

  let norm;
  try {
    norm = await normalizeToWebp(file.data);
  } catch (err) {
    return {
      index,
      filename,
      status: "rejected",
      reason: `Nelze zpracovat jako obrázek: ${(err as Error).message}`,
    };
  }

  const { reused } = await writeStagedPhoto({
    sha1: norm.sha1,
    webBuf: norm.webBuf,
    thumbBuf: norm.thumbBuf,
  });
  return {
    index,
    filename,
    status: "ok",
    sha1: norm.sha1,
    sourceFormat: norm.sourceFormat,
    reused,
  };
}
