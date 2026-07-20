"use server";

import { revalidatePath } from "next/cache";
import { ImageType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { appendAudit } from "@/lib/admin/audit";
import { setFindsAnonymized } from "@/lib/admin/findAnonymize";
import { parseFindFilename } from "@/lib/parseFilename";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";

export interface AnonymizeNeFilenameResult {
  ok: boolean;
  findsAffected?: number;
  photosRenamed?: number;
  jsonAdded?: number;
  errors?: number;
  error?: string;
}

/**
 * One-click fix for the `json-not-in-filename` check's anonymisation
 * mismatches: a find is anonymised in the DB (via JSON list or an
 * anonymised location) but its photo filename still carries `+NE+`. Renames
 * those originals + crops to `+ANO+` so the filename matches. The JSON
 * already lists them (no-op there); the rename lands in the DB on the next
 * sync. Only touches finds whose filename is out of step — already-ANO
 * finds are skipped.
 */
export async function anonymizeMismatchedFilenames(): Promise<AnonymizeNeFilenameResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) return { ok: false, error: "Unauthenticated" };
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const anonFinds = await prisma.find.findMany({
    where: { isAnonymized: true },
    select: { id: true },
  });
  if (anonFinds.length === 0) return { ok: true, findsAffected: 0 };

  const images = await prisma.findImage.findMany({
    where: {
      findId: { in: anonFinds.map((f) => f.id) },
      imageType: ImageType.ORIGINAL,
    },
    select: { findId: true, originalFilename: true },
  });

  const targets = new Set<number>();
  for (const img of images) {
    const parsed = parseFindFilename(img.originalFilename);
    if (parsed.ok && !parsed.value.isAnonymized) targets.add(img.findId);
  }
  if (targets.size === 0) return { ok: true, findsAffected: 0 };

  const bulk = await setFindsAnonymized([...targets], true);

  await appendAudit({
    action: "file.rename",
    ip,
    credentialLabel,
    details: {
      scope: "finds",
      reason: "checks-anonymize-ne-filename",
      finds_targeted: targets.size,
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
    findsAffected: targets.size,
    photosRenamed: bulk.photosRenamed,
    jsonAdded: bulk.jsonAdded.length,
    errors: bulk.errors.length,
  };
}
