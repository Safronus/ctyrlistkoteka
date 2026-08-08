import { NextResponse, type NextRequest } from "next/server";
import {
  getAdminSession,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { readDropXlsx, safeArchiveName } from "@/lib/admin/dropXlsxArchive";

/**
 * GET /admin/api/drops/<campaign>/xlsx/<archived name>
 *
 * Hands back one previously uploaded workbook, byte for byte. Auth-gated
 * like the export it mirrors — these sheets carry the hiding coordinates.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> },
): Promise<Response> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return new NextResponse("Not found", { status: 404 });
  }
  await touchSession();

  const { id, name } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return new NextResponse("Bad request", { status: 400 });
  }

  let buf: Buffer;
  try {
    buf = await readDropXlsx(campaignId, safeArchiveName(decodeURIComponent(name)));
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
