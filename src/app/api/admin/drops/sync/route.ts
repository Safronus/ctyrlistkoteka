import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { syncCampaignFromSheet } from "@/lib/admin/dropSheetSync";

/**
 * Background pull of every sheet-run wave. Called by a systemd timer on
 * the box — see deploy/drop-sheet-sync.*.
 *
 * NOT session-authenticated: a timer has no session. Gated on a shared
 * secret instead, and **disabled entirely when that secret is unset**, so
 * an install that never configured it cannot be poked from outside. The
 * endpoint only ever pulls; it can create nothing and delete nothing.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const expected = process.env.DROP_SHEET_SYNC_TOKEN;
  if (!expected) {
    // Never configured — behave as if the route did not exist.
    return new NextResponse("Not found", { status: 404 });
  }
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!given || given !== expected) {
    return new NextResponse("Not found", { status: 404 });
  }

  const campaigns = await prisma.dropCampaign.findMany({
    where: { sheetMode: true, sheetUrl: { not: null }, archivedAt: null },
    select: { id: true, name: true },
  });

  const results = [];
  for (const c of campaigns) {
    // Sequential on purpose: a handful of waves at most, and hammering
    // Google with parallel exports is exactly how a shared link starts
    // getting throttled.
    results.push({ id: c.id, name: c.name, ...(await syncCampaignFromSheet(c.id)) });
  }

  return NextResponse.json(
    { checked: results.length, results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
