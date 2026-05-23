"use server";

import { revalidatePath } from "next/cache";
import { appendAudit } from "@/lib/admin/audit";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { prisma } from "@/lib/db";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";

/**
 * Admin server actions for the public-voting feature. Every action
 * gates on `ensureAdminAuth` so an unauthenticated request 401s
 * before touching the DB. All destructive operations write an audit
 * row so an accidental mass-delete can be reconstructed from logs.
 *
 * The `confirm` form input is a server-side belt-and-suspenders
 * check: the client UI also asks for confirmation, but a malicious
 * caller posting raw FormData would skip that. Rejecting any value
 * other than the expected literal makes the action genuinely
 * intentional, not just "anyone with admin cookie can wipe votes
 * via curl".
 */

async function requireAdmin(): Promise<{ ip: string; credentialLabel: string }> {
  await ensureAdminAuth();
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    throw new Error("Unauthenticated");
  }
  await touchSession();
  return {
    ip: await getRequestIp(),
    credentialLabel: session.credentialLabel!,
  };
}

/** Delete a single vote by composite key. The form posts both
 *  parts; we tolerate either find id as integer or the row not
 *  existing (idempotent — admin retry is safe). */
export async function deleteOneVote(formData: FormData): Promise<void> {
  const { ip, credentialLabel } = await requireAdmin();

  const findIdRaw = formData.get("findId");
  const voterUuid = formData.get("voterUuid");
  if (typeof findIdRaw !== "string" || typeof voterUuid !== "string") {
    throw new Error("Missing inputs");
  }
  if (!/^[1-9]\d*$/.test(findIdRaw)) {
    throw new Error("Invalid findId");
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      voterUuid,
    )
  ) {
    throw new Error("Invalid voterUuid");
  }
  const findId = Number(findIdRaw);

  // deleteMany tolerates 0 matches; we then read affected count for
  // the audit row.
  const { count } = await prisma.findVote.deleteMany({
    where: { findId, voterUuid },
  });

  await appendAudit({
    action: "vote.delete",
    ip,
    credentialLabel,
    details: {
      scope: "single",
      findId,
      voterUuid,
      affected: count,
    },
  });
  revalidatePath("/admin/votes");
}

/** Bulk-delete every vote sharing a fingerprint (typical ballot-
 *  stuffing pattern: many votes from one IP+UA). The audit row
 *  records the fingerprint + affected count for forensic trail. */
export async function deleteVotesByFingerprint(
  formData: FormData,
): Promise<void> {
  const { ip, credentialLabel } = await requireAdmin();

  const fingerprint = formData.get("fingerprint");
  if (typeof fingerprint !== "string" || !/^[0-9a-f]{40}$/.test(fingerprint)) {
    throw new Error("Invalid fingerprint");
  }

  const { count } = await prisma.findVote.deleteMany({
    where: { fingerprint },
  });

  await appendAudit({
    action: "vote.delete",
    ip,
    credentialLabel,
    details: {
      scope: "fingerprint",
      fingerprint,
      affected: count,
    },
  });
  revalidatePath("/admin/votes");
}

/** Bulk-delete every vote from one cookie UUID — useful when the
 *  audit log reveals one persistent voter has voted for "obviously
 *  too many" finds. */
export async function deleteVotesByVoterUuid(
  formData: FormData,
): Promise<void> {
  const { ip, credentialLabel } = await requireAdmin();

  const voterUuid = formData.get("voterUuid");
  if (
    typeof voterUuid !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      voterUuid,
    )
  ) {
    throw new Error("Invalid voterUuid");
  }
  const { count } = await prisma.findVote.deleteMany({
    where: { voterUuid },
  });

  await appendAudit({
    action: "vote.delete",
    ip,
    credentialLabel,
    details: {
      scope: "voter_uuid",
      voterUuid,
      affected: count,
    },
  });
  revalidatePath("/admin/votes");
}

/**
 * NUKE — delete every single vote in the table. Destructive; requires
 * the operator to type a confirmation phrase in the client UI, which
 * the form posts as `confirm=RESET_ALL`. Anything else 4xx-rejects
 * before the delete fires.
 *
 * The denormalized `finds.vote_count` cache is re-zeroed in the same
 * transaction so /sbirka and the leaderboards reflect the wipe
 * immediately, not when the next vote comes in.
 */
export async function resetAllVotes(formData: FormData): Promise<void> {
  const { ip, credentialLabel } = await requireAdmin();

  const confirm = formData.get("confirm");
  if (confirm !== "RESET_ALL") {
    throw new Error("Reset confirmation token mismatch");
  }

  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.findVote.count();
    await tx.findVote.deleteMany({});
    // Trigger keeps `vote_count` in sync on each delete, but a mass
    // wipe re-zeroes the column explicitly so we don't leave a tiny
    // race window where the cache lags behind. Also makes a brand-
    // new DB dump (no trigger fires) consistent.
    await tx.find.updateMany({ data: { voteCount: 0 } });
    return { before };
  });

  await appendAudit({
    action: "vote.reset_all",
    ip,
    credentialLabel,
    details: {
      affected: result.before,
    },
  });
  revalidatePath("/admin/votes");
  revalidatePath("/sbirka");
  revalidatePath("/", "layout");
}
