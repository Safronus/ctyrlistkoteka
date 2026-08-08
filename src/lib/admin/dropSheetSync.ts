import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { appendAudit } from "@/lib/admin/audit";
import { parseDropXlsx } from "@/lib/admin/dropXlsx";
import { planDropImport, type DropPlan } from "@/lib/admin/dropPlan";
import { archiveDropXlsx } from "@/lib/admin/dropXlsxArchive";
import {
  parseSheetUrl,
  fetchSheetWorkbook,
  SheetFetchError,
} from "@/lib/admin/dropSheet";

/**
 * The Google Sheets pull, in one place.
 *
 * Lives outside the actions module because a `"use server"` file may only
 * export async server actions — and this has to be callable from the
 * background route as well, which has no session and no form.
 */

/** Node hands back a Buffer over a pooled allocation; the parser wants
 *  only this file's bytes. */
export function toArrayBufferForPlan(b: Buffer): ArrayBuffer {
  const out = new ArrayBuffer(b.byteLength);
  new Uint8Array(out).set(b);
  return out;
}

export function revalidateCampaign(campaignId?: number): void {
  revalidatePath("/admin/qr");
  if (campaignId) revalidatePath(`/admin/qr/darovani/${campaignId}`);
}

/**
 * Works out what a workbook would do to a wave. Shared by the manual
 * upload and the sheet pull so the two cannot reach different conclusions
 * about the same file.
 *
 * `tolerant` splits one failure into two behaviours. A sheet with nothing
 * readable at all — wrong file, missing key column — is fatal either way.
 * A sheet where SOME cell is malformed is not: a hand-uploaded file still
 * refuses, because the operator is watching and can fix a typo; the
 * shared sheet does not, because one person's half-typed coordinate must
 * not stop four other people's work on every poll, silently.
 */
export async function planFromWorkbook(
  campaignId: number,
  data: ArrayBuffer,
  opts: { tolerant?: boolean } = {},
): Promise<{ ok: false; errors: string[] } | { ok: true; plan: DropPlan }> {
  const parsed = await parseDropXlsx(data);

  const fatal = parsed.rows.length === 0 && parsed.errors.length > 0;
  if (fatal || (parsed.errors.length > 0 && !opts.tolerant)) {
    return { ok: false, errors: parsed.errors.slice(0, 50) };
  }

  const [items, areas, campaign] = await Promise.all([
    prisma.dropItem.findMany({ where: { campaignId } }),
    prisma.dropArea.findMany({ where: { campaignId } }),
    prisma.dropCampaign.findUnique({ where: { id: campaignId } }),
  ]);
  if (!campaign) return { ok: false, errors: ["Sada nenalezena"] };

  const plan = planDropImport(
    parsed.rows,
    items,
    {
      ...campaign,
      exportedDefaults: (campaign.exportedDefaults ?? null) as Record<
        string,
        string | null
      > | null,
    },
    areas,
  );
  // Tolerated problems ride along as warnings, so nothing is skipped
  // without being named.
  plan.report.errors = parsed.errors.slice(0, 50);
  return { ok: true, plan };
}

/** Writes a plan. One transaction — a sheet lands whole or not at all. */
export async function applyPlan(
  campaignId: number,
  plan: DropPlan,
  source: string,
  ip: string,
): Promise<void> {
  if (plan.updates.length === 0) return;
  await prisma.$transaction(
    plan.updates.map((u) =>
      prisma.dropItem.update({ where: { id: u.id }, data: u.data }),
    ),
  );
  await appendAudit({
    action: "settings.update",
    ip,
    details: {
      drops: source,
      campaignId,
      changed: plan.report.changed,
      cleared: plan.report.cleared,
    },
  });
  revalidateCampaign(campaignId);
}

export interface SyncOutcome {
  ok: boolean;
  /** True when the download was byte-identical to the last one. */
  unchanged?: boolean;
  changed?: number;
  skipped?: number;
  error?: string;
}

/**
 * Fetch → plan → apply, recording the outcome on the campaign.
 *
 * The unchanged case short-circuits before parsing: a wave polled every
 * five minutes is the same file almost every time, and hashing the
 * download is far cheaper than opening it.
 */
export async function syncCampaignFromSheet(
  campaignId: number,
  ip = "system",
): Promise<SyncOutcome> {
  const campaign = await prisma.dropCampaign.findUnique({
    where: { id: campaignId },
    select: { sheetUrl: true, sheetHash: true },
  });
  const ref = campaign?.sheetUrl ? parseSheetUrl(campaign.sheetUrl) : null;
  if (!ref) return { ok: false, error: "Sada nemá uložený odkaz na tabulku" };

  const now = new Date();
  try {
    const fetched = await fetchSheetWorkbook(ref);

    if (fetched.hash === campaign?.sheetHash) {
      await prisma.dropCampaign.update({
        where: { id: campaignId },
        data: { sheetSyncedAt: now, sheetError: null },
      });
      return { ok: true, unchanged: true, changed: 0 };
    }

    const result = await planFromWorkbook(
      campaignId,
      toArrayBufferForPlan(fetched.bytes),
      { tolerant: true },
    );

    if (!result.ok) {
      await prisma.dropCampaign.update({
        where: { id: campaignId },
        data: { sheetSyncedAt: now, sheetError: result.errors[0] ?? null },
      });
      await archiveDropXlsx(
        campaignId,
        fetched.bytes,
        {
          originalName: "google-sheets.xlsx",
          matched: 0,
          changed: 0,
          blocked: true,
        },
        now,
      );
      revalidateCampaign(campaignId);
      return { ok: false, error: result.errors[0] };
    }

    await applyPlan(campaignId, result.plan, "sheet-sync", ip);
    await prisma.dropCampaign.update({
      where: { id: campaignId },
      data: {
        sheetHash: fetched.hash,
        sheetSyncedAt: now,
        sheetChangedAt: now,
        sheetError: null,
      },
    });
    await archiveDropXlsx(
      campaignId,
      fetched.bytes,
      {
        originalName: "google-sheets.xlsx",
        matched: result.plan.report.matched,
        changed: result.plan.report.changed,
        blocked: false,
      },
      now,
    );
    revalidateCampaign(campaignId);
    return {
      ok: true,
      unchanged: false,
      changed: result.plan.report.changed,
      skipped: result.plan.report.errors.length,
    };
  } catch (e) {
    const error =
      e instanceof SheetFetchError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Synchronizace selhala";
    // Recorded rather than thrown: a background run nobody is watching
    // must leave its failure somewhere visible.
    await prisma.dropCampaign
      .update({ where: { id: campaignId }, data: { sheetError: error } })
      .catch(() => undefined);
    revalidateCampaign(campaignId);
    return { ok: false, error };
  }
}
