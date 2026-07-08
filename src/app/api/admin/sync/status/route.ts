import { NextResponse, type NextRequest } from "next/server";
import { tryRequireAuth } from "@/lib/admin/session";
import { getStatus, tailLog } from "@/lib/admin/syncRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Polled by the SyncPanel client every ~750 ms. Returns the current
 *  status JSON plus any log bytes appended since the last poll's
 *  offset. The client renders new bytes by appending to its buffer. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // tryRequireAuth also refreshes the sliding TTL, which is exactly what
  // this poll endpoint wants: an admin watching a long sync stays
  // signed in for its whole duration.
  const session = await tryRequireAuth();
  if (!session) {
    return new NextResponse("Not found", { status: 404 });
  }

  const sp = request.nextUrl.searchParams;
  const offsetParam = sp.get("offset");
  const offset = offsetParam ? Math.max(0, Number(offsetParam) | 0) : 0;

  const status = await getStatus();
  if (!status) {
    return NextResponse.json({ status: null, log: "", offset: 0 });
  }
  const tail = await tailLog(status.runId, offset);
  return NextResponse.json({
    status,
    log: tail.bytes,
    offset: tail.nextOffset,
  });
}
