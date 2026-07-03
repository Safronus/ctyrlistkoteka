"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { appendAudit } from "@/lib/admin/audit";
import { setFindsAnonymized } from "@/lib/admin/findAnonymize";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";

export interface AnonymizeAnonLocResult {
  ok: boolean;
  /** Finds that were targeted (offenders of the check). */
  findsAffected?: number;
  /** Original photos renamed (pole 5 flipped); crops ride along. */
  photosRenamed?: number;
  /** Find IDs newly added to anonymizace.ANONYMIZOVANE. */
  jsonAdded?: number;
  /** Per-file rename failures (non-fatal — sync still enforces). */
  errors?: number;
  error?: string;
}

/**
 * One-click fix for the anonymised-location consistency check: make EVERY
 * find on a location with an anonymised map fully consistent — filename
 * `+ANO+` in the original + crop AND listed in LokaceStavyPoznamky.json.
 * `setFindsAnonymized` is idempotent, so already-consistent finds are
 * skipped (no rename, no-op JSON). Lands in the DB on the next `pnpm sync`.
 */
export async function anonymizeAnonLocationFinds(): Promise<AnonymizeAnonLocResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) return { ok: false, error: "Unauthenticated" };
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const anonMaps = await prisma.locationMap.findMany({
    where: { isAnonymized: true },
    select: { locationId: true },
  });
  const anonLocIds = [...new Set(anonMaps.map((m) => m.locationId))];
  if (anonLocIds.length === 0) return { ok: true, findsAffected: 0 };

  const finds = await prisma.find.findMany({
    where: { locationId: { in: anonLocIds } },
    select: { id: true },
  });
  const ids = finds.map((f) => f.id);
  if (ids.length === 0) return { ok: true, findsAffected: 0 };

  const bulk = await setFindsAnonymized(ids, true);

  await appendAudit({
    action: "file.rename",
    ip,
    credentialLabel,
    details: {
      scope: "finds",
      reason: "checks-anonymize-anon-loc",
      finds_targeted: ids.length,
      photos_renamed: bulk.photosRenamed,
      json_added: bulk.jsonAdded.length,
      errors: bulk.errors.length,
    },
  });

  revalidatePath("/admin/checks");
  revalidatePath("/admin/files/finds");
  revalidatePath("/admin/json/lokace-stavy-poznamky");

  return {
    ok: true,
    findsAffected: ids.length,
    photosRenamed: bulk.photosRenamed,
    jsonAdded: bulk.jsonAdded.length,
    errors: bulk.errors.length,
  };
}
