import { NextResponse, type NextRequest } from "next/server";
import {
  getAdminSession,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import {
  cleanupImportUpload,
  importZipPath,
  isValidUploadId,
} from "@/lib/admin/importPackage";
import { recordImportEvent } from "@/lib/admin/importHistory";
import { promises as fs } from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Discards an uploaded-but-not-committed package (user hit Cancel at the
 *  review step). Deletes the temp ZIP now instead of leaving it for the
 *  import-tmp GC cron. No-op on an unknown id. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  await touchSession();

  let body: { uploadId?: string; fileName?: string; packageType?: string };
  try {
    body = (await request.json()) as {
      uploadId?: string;
      fileName?: string;
      packageType?: string;
    };
  } catch {
    return NextResponse.json(
      { ok: false, error: "Neplatné tělo požadavku." },
      { status: 400 },
    );
  }
  const uploadId = body.uploadId ?? "";
  if (isValidUploadId(uploadId)) {
    // Size first — cleanup deletes the file this reads.
    const bytes = await fs
      .stat(importZipPath(uploadId))
      .then((s) => s.size)
      .catch(() => 0);
    await cleanupImportUpload(uploadId);
    // Only when the operator actually saw a plan and backed out. A cancel
    // during upload leaves nothing worth a line.
    if (body.packageType) {
      await recordImportEvent({
        uploadId,
        fileName: (body.fileName ?? "").slice(0, 200) || uploadId,
        bytes,
        packageType:
          body.packageType === "v1" ||
          body.packageType === "v2" ||
          body.packageType === "photos"
            ? body.packageType
            : "unknown",
        outcome: "cancelled",
      });
    }
  }
  return NextResponse.json({ ok: true });
}
