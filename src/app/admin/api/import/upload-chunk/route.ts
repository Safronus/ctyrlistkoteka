import { promises as fs } from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { ensureDir } from "@/lib/admin/atomic";
import { drainRequestBody } from "@/lib/admin/multipart";
import {
  getAdminSession,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import {
  importTmpDir,
  importZipPath,
  isValidUploadId,
  MAX_IMPORT_CHUNK_BYTES,
  MAX_IMPORT_ZIP_BYTES,
} from "@/lib/admin/importPackage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChunkResponse {
  ok: boolean;
  received?: number;
  error?: string;
}

/**
 * One chunk of a "web package" ZIP upload. The client slices the archive into
 * ≤8 MB pieces and POSTs each here with `?uploadId=<uuid>&offset=<bytes>`; the
 * raw chunk bytes are the request body. Each chunk is written at its byte
 * offset into data/.admin/import-tmp/<uploadId>.zip, so a hundreds-of-MB
 * package reassembles on disk without any single request hitting the ~10 MB
 * body-truncation cap. offset=0 creates/truncates the file (fresh upload).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    await drainRequestBody(request);
    return json({ ok: false, error: "Not found" }, 404);
  }
  await touchSession();

  const sp = request.nextUrl.searchParams;
  const uploadId = sp.get("uploadId") ?? "";
  if (!isValidUploadId(uploadId)) {
    await drainRequestBody(request);
    return json({ ok: false, error: "Neplatné upload id." }, 400);
  }
  const offset = Number(sp.get("offset"));
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_IMPORT_ZIP_BYTES) {
    await drainRequestBody(request);
    return json({ ok: false, error: "Neplatný offset." }, 400);
  }

  let chunk: Buffer;
  try {
    chunk = Buffer.from(await request.arrayBuffer());
  } catch (err) {
    return json(
      { ok: false, error: `Čtení části selhalo: ${(err as Error).message}` },
      400,
    );
  }
  if (chunk.byteLength === 0) {
    return json({ ok: false, error: "Prázdná část." }, 400);
  }
  if (chunk.byteLength > MAX_IMPORT_CHUNK_BYTES) {
    return json({ ok: false, error: "Část je příliš velká." }, 413);
  }
  if (offset + chunk.byteLength > MAX_IMPORT_ZIP_BYTES) {
    return json({ ok: false, error: "Balíček přesahuje povolenou velikost." }, 413);
  }

  const zipPath = importZipPath(uploadId);
  try {
    await ensureDir(importTmpDir());
    // offset 0 → create/truncate (fresh upload); later chunks → write at
    // position into the existing file.
    const fh = await fs.open(zipPath, offset === 0 ? "w" : "r+");
    try {
      await fh.write(chunk, 0, chunk.byteLength, offset);
    } finally {
      await fh.close();
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" && offset > 0) {
      return json(
        { ok: false, error: "Chybí předchozí část — začni nahrávání znovu." },
        409,
      );
    }
    console.error("[admin/import/upload-chunk] write failed", {
      uploadId,
      offset,
      code,
      message: (err as Error).message,
    });
    return json({ ok: false, error: `Zápis části selhal: ${(err as Error).message}` }, 500);
  }

  return json({ ok: true, received: offset + chunk.byteLength });
}

function json(body: ChunkResponse, status = 200): NextResponse {
  return NextResponse.json<ChunkResponse>(body, { status });
}
