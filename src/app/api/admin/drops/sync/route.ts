import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { syncCampaignFromSheet } from "@/lib/admin/dropSheetSync";
import { isLoopbackChain, tokenMatches } from "@/lib/admin/dropSyncGate";

/**
 * Background pull of every sheet-run wave. Called by a systemd timer on
 * the box — see deploy/drop-sheet-sync.*.
 *
 * A timer has no session, so this cannot use the admin cookie. Three
 * things gate it instead, and it takes all three:
 *
 *  1. **A shared secret**, compared in constant time, and required to be
 *     long enough to be worth comparing. Absent from the environment,
 *     the route behaves as if it did not exist.
 *  2. **Loopback only.** The timer curls 127.0.0.1:3000 directly. This
 *     matters because the Nginx admin cloak matches the prefix `/admin`,
 *     which `/api/admin/...` does NOT start with — so without this the
 *     endpoint would be internet-facing with the token as its only
 *     protection.
 *  3. **A tiny blast radius by construction.** It cannot create, delete
 *     or address anything: it pulls the sheet each campaign already has,
 *     and `parseSheetUrl` only ever yields a docs.google.com URL, so it
 *     is not an SSRF lever either. The worst a leaked token buys is
 *     forcing syncs that would have happened anyway.
 *
 * Failures answer 404 rather than 401 — an endpoint that distinguishes
 * "wrong token" from "no such route" tells a prober it found something.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new NextResponse("Not found", { status: 404 });

/**
 * The setup guide says `openssl rand -hex 32`. A token short enough to be
 * guessed would make everything below theatre, so a short one counts as
 * no token at all — with a log line, because silently doing nothing is
 * how a broken sync goes unnoticed for a month.
 */
const MIN_TOKEN_LENGTH = 24;
let warnedAboutShortToken = false;

export async function POST(req: NextRequest): Promise<Response> {
  const expected = process.env.DROP_SHEET_SYNC_TOKEN;
  if (!expected) return NOT_FOUND();

  if (expected.length < MIN_TOKEN_LENGTH) {
    if (!warnedAboutShortToken) {
      warnedAboutShortToken = true;
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "drop_sync_token_too_short",
          length: expected.length,
          required: MIN_TOKEN_LENGTH,
        }),
      );
    }
    return NOT_FOUND();
  }

  // Came through the proxy → came from the internet → not our timer.
  if (!isLoopbackChain(req.headers.get("x-forwarded-for"))) return NOT_FOUND();

  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!given || !tokenMatches(given, expected)) return NOT_FOUND();

  const campaigns = await prisma.dropCampaign.findMany({
    where: { sheetMode: true, sheetUrl: { not: null }, archivedAt: null },
    select: { id: true, name: true },
  });

  const results = [];
  for (const c of campaigns) {
    // Sequential on purpose: a handful of waves at most, and hammering
    // Google with parallel exports is exactly how a shared link starts
    // getting throttled.
    results.push({
      id: c.id,
      name: c.name,
      ...(await syncCampaignFromSheet(c.id)),
    });
  }

  return NextResponse.json(
    { checked: results.length, results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
