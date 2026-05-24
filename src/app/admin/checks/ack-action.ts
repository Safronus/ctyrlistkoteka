"use server";

import { revalidatePath } from "next/cache";
import { addCheckAck } from "@/lib/admin/checkAcks";
import { MAP_CENTER_POLYGON_CHECK_ID } from "@/lib/admin/checks";
import { appendAudit } from "@/lib/admin/audit";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";

/** Whitelist of check ids the ack action will accept. Free-form
 *  ids would let a tampered request write arbitrary keys into
 *  check-acks.json — bound it explicitly to the ids that have an
 *  ack UI today (currently just the map/polygon check). Add to
 *  this set when wiring acks for additional checks. */
const ACKABLE_CHECK_IDS = new Set<string>([MAP_CENTER_POLYGON_CHECK_ID]);

/** Marks a single check offender as "OK, intentionally" — the row
 *  disappears from the next render of /admin/checks. The ack
 *  persists in data/.admin/check-acks.json across sync runs. There
 *  is no undo button in the UI today; if you mis-ack something,
 *  edit that JSON manually (or add a remove server action later). */
export async function markCheckOk(
  checkId: string,
  offenderId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, error: "Neautentizováno" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  if (!ACKABLE_CHECK_IDS.has(checkId)) {
    return { ok: false, error: `Neznámý check id: ${checkId}` };
  }
  if (!Number.isInteger(offenderId) || offenderId <= 0) {
    return { ok: false, error: "Neplatné id záznamu" };
  }

  try {
    await addCheckAck(checkId, offenderId);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Zápis selhal",
    };
  }

  await appendAudit({
    action: "json.update",
    ip,
    credentialLabel,
    details: {
      target: "check-acks.json",
      checkId,
      offenderId,
    },
  });

  revalidatePath("/admin/checks");
  return { ok: true };
}
