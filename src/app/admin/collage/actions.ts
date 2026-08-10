"use server";

import { requireAuth, getRequestIp } from "@/lib/admin/session";
import { appendAudit } from "@/lib/admin/audit";
import {
  getCollageStatus,
  listCollageBatches,
  startCollageRun,
  tailCollageLog,
  type CollageBatch,
  type CollageRunStatus,
} from "@/lib/admin/collageRunner";
import { COLLAGE_VARIANTS, type CollageVariant } from "@/lib/collage";

export interface CollageView {
  status: CollageRunStatus | null;
  log: string;
  batches: CollageBatch[];
}

/** Everything the panel polls for, in one round trip. */
export async function collageViewAction(): Promise<CollageView> {
  await requireAuth();
  const [status, log, batches] = await Promise.all([
    getCollageStatus(),
    tailCollageLog(),
    listCollageBatches(),
  ]);
  return { status, log, batches };
}

export async function startCollageAction(input: {
  minId: string;
  maxId: string;
  variants: string[];
  live: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAuth();
  const variants = (
    Array.isArray(input.variants) ? input.variants : []
  ).filter((v): v is CollageVariant =>
    COLLAGE_VARIANTS.includes(v as CollageVariant),
  );
  try {
    const status = await startCollageRun({
      minId: Number(input.minId),
      maxId: Number(input.maxId),
      variants,
      live: Boolean(input.live),
      startedBy: session.credentialLabel ?? "?",
    });
    await appendAudit({
      action: "collage.run",
      ip: await getRequestIp(),
      credentialLabel: session.credentialLabel ?? undefined,
      details: {
        runId: status.runId,
        range: `${status.minId}-${status.maxId}`,
        variants: status.variants.join(","),
        // Worth its own field: this is the one that replaces what the
        // landing pages serve.
        live: status.live,
      },
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Spuštění selhalo",
    };
  }
}
