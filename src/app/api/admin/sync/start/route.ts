import { NextResponse, type NextRequest } from "next/server";
import { appendAudit } from "@/lib/admin/audit";
import { getRequestIp, tryRequireAuth } from "@/lib/admin/session";
import { startRun } from "@/lib/admin/syncRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Triggers a `tsx scripts/sync.ts` run with the requested flags.
 *  Refuses when a run is already in progress (the runner does the
 *  check on disk, so it's race-safe across PM2 cluster workers). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // tryRequireAuth also refreshes the sliding TTL — no separate
  // touchSession() call needed.
  const session = await tryRequireAuth();
  if (!session) {
    return new NextResponse("Not found", { status: 404 });
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();

  let body: { dryRun?: boolean; only?: string };
  try {
    body = (await request.json()) as { dryRun?: boolean; only?: string };
  } catch {
    body = {};
  }
  const dryRun = Boolean(body.dryRun);
  let only: "maps" | "finds" | "meta" | undefined;
  if (body.only === "maps" || body.only === "finds" || body.only === "meta") {
    only = body.only;
  }

  try {
    const status = await startRun({ dryRun, only, startedBy: credentialLabel });
    await appendAudit({
      action: "sync.start",
      ip,
      credentialLabel,
      details: {
        runId: status.runId,
        args: status.args,
        dryRun,
        only: only ?? null,
      },
    });
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendAudit({
      action: "sync.start",
      ip,
      credentialLabel,
      details: { outcome: "rejected", reason: message },
    });
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
