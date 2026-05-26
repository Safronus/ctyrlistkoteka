"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { appendAudit } from "@/lib/admin/audit";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";

/** Hard cap on the stored code — matches MAX_CODE_LENGTH in
 *  findPhotoUnlock.ts so anything that goes IN here is also accepted
 *  by the verifier. Long enough for a Diceware passphrase, short
 *  enough to keep oversized payloads out of the DB row. */
const MAX_CODE_LENGTH = 256;

/** Minimum length we accept. Below this the recipient could brute-
 *  force the code even through Nginx + per-attempt stall, so refuse
 *  to persist a configuration that's effectively wide-open. The
 *  client-side generator produces 6 chars by default. */
const MIN_CODE_LENGTH = 4;

/**
 * Sets, replaces, or clears the per-find unlock code for anonymized
 * donation photos. Called from the admin donation-photo detail page.
 *
 * - `code = null` (or empty string): clears the override → unlock
 *   falls back to the global FIND_PHOTO_UNLOCK_CODE env var.
 * - `code = "..."` (4–256 chars): stored verbatim. The verifier in
 *   src/lib/actions/findPhotoUnlock.ts reads this column and uses it
 *   in place of the global secret for THIS find only.
 *
 * Idempotent — submitting the same code twice is a no-op besides one
 * audit entry. Always revalidates the donation-photo detail page so
 * the panel re-renders with the saved value (or the cleared state).
 */
export async function setFindUnlockCode(
  findId: number,
  code: string | null,
): Promise<{ ok: true; code: string | null } | { ok: false; error: string }> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, error: "Neautentizováno" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  if (!Number.isInteger(findId) || findId <= 0) {
    return { ok: false, error: "Neplatné findId" };
  }

  // Normalize: trim whitespace, treat empty/whitespace-only as clear.
  const normalized =
    code !== null ? code.trim() : null;
  const persisted: string | null =
    normalized === null || normalized.length === 0 ? null : normalized;

  if (persisted !== null) {
    if (persisted.length < MIN_CODE_LENGTH) {
      return {
        ok: false,
        error: `Kód musí mít aspoň ${MIN_CODE_LENGTH} znaků (jinak je triviálně uhodnutelný i přes rate-limit).`,
      };
    }
    if (persisted.length > MAX_CODE_LENGTH) {
      return {
        ok: false,
        error: `Kód je delší než ${MAX_CODE_LENGTH} znaků.`,
      };
    }
  }

  let result;
  try {
    result = await prisma.find.update({
      where: { id: findId },
      data: { unlockCode: persisted },
      select: { id: true, unlockCode: true },
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update selhal",
    };
  }

  await appendAudit({
    action: "json.update",
    ip,
    credentialLabel,
    details: {
      target: "find.unlock_code",
      findId,
      // Log only the *fact* of the change + length, never the code
      // itself. Audit log is plain-text on disk; logging the secret
      // would defeat its purpose if the log ever leaks.
      operation: persisted === null ? "clear" : "set",
      codeLength: persisted?.length ?? 0,
    },
  });

  // Detail page re-renders with the new value. We intentionally
  // don't revalidate the public /sbirka/<id> page — the unlock
  // panel there reads the code via the server action at attempt
  // time, not via SSR snapshot, so no cache to bust.
  revalidatePath("/admin/files/donation-photos", "layout");

  return { ok: true, code: result.unlockCode };
}
