import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { revalidatePublicSurfaces } from "@/lib/revalidate";

/**
 * On-demand revalidation trigger for the CLI sync (`pnpm sync` in Termius).
 * The sync script runs OUTSIDE the Next.js runtime, so it can't call
 * revalidateTag/revalidatePath itself; instead it POSTs here (over
 * 127.0.0.1 once an import finishes) and this in-server handler drops the
 * stale caches. The admin-UI sync path revalidates in-process and doesn't
 * need this.
 *
 * Auth: a bearer token from `REVALIDATE_TOKEN`. The repo is public, so the
 * gate has to be a secret, not the path. It fails CLOSED — with no token
 * configured it never revalidates. Living under `/api/admin` also puts it
 * behind the Nginx admin cloak for external callers; the localhost ping
 * reaches the Next server directly and bypasses that.
 */
export const dynamic = "force-dynamic";

function tokenValid(provided: string | null): boolean {
  const expected = process.env.REVALIDATE_TOKEN;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on unequal-length buffers.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!process.env.REVALIDATE_TOKEN) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const header = req.headers.get("authorization");
  const provided = header?.startsWith("Bearer ")
    ? header.slice(7)
    : req.headers.get("x-revalidate-token");
  if (!tokenValid(provided)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  revalidatePublicSurfaces();
  return NextResponse.json({ revalidated: true });
}
