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
 * configured it never revalidates.
 *
 * Every failure answers a bare 404, like every route under `/api/admin/*`:
 * the Nginx cloak is `location /admin` (a prefix), so `/api/admin/…` is not
 * reliably behind it, and a 401 / 503 tells a scanner it found something.
 * The CLI sync explains a 404 itself (scripts/sync.ts).
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
  const header = req.headers.get("authorization");
  const provided = header?.startsWith("Bearer ")
    ? header.slice(7)
    : req.headers.get("x-revalidate-token");
  // Unconfigured and wrong token look the same from outside — on purpose.
  if (!tokenValid(provided)) {
    return new NextResponse("Not found", { status: 404 });
  }
  revalidatePublicSurfaces();
  return NextResponse.json({ revalidated: true });
}
