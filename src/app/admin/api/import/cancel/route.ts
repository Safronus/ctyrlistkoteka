import { NextResponse, type NextRequest } from "next/server";
import {
  getAdminSession,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import {
  cleanupImportUpload,
  isValidUploadId,
} from "@/lib/admin/importPackage";

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

  let body: { uploadId?: string };
  try {
    body = (await request.json()) as { uploadId?: string };
  } catch {
    return NextResponse.json(
      { ok: false, error: "Neplatné tělo požadavku." },
      { status: 400 },
    );
  }
  const uploadId = body.uploadId ?? "";
  if (isValidUploadId(uploadId)) {
    await cleanupImportUpload(uploadId);
  }
  return NextResponse.json({ ok: true });
}
