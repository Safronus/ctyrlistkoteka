"use server";

import { promises as fs } from "node:fs";
import { revalidatePath } from "next/cache";
import { appendAudit } from "@/lib/admin/audit";
import { safeBaseName, safeJoin } from "@/lib/admin/paths";
import { resolveDiskPath } from "@/lib/admin/scopes";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { invalidateFindPhotosCache } from "@/lib/findPhotos";

/** Donation-photo filename pattern: `<findId><slot>_DAR[_ANON].<ext>`.
 *  Mirrors src/lib/findPhotos.ts and the upload route's validation
 *  regex so the toggle's output is always a legal name the public
 *  reader will pick up. */
const FILENAME_RE = /^(\d+)([a-z])_DAR(_ANON)?\.(jpe?g|png|webp)$/i;

export interface AnonymizeDonationPhotoResult {
  ok: boolean;
  filename: string;
  /** Set on success — the photo's new on-disk name. Client uses this
   *  to redirect from /admin/files/donation-photos/<oldName> to the
   *  renamed page so the URL doesn't 404 after the toggle. */
  newFilename?: string;
  error?: string;
}

/**
 * Flips the anonymization token on a single donation photo by
 * renaming the file on disk: `_DAR.` ⇆ `_DAR_ANON.`. The `_ANON`
 * variant is the one Nginx 404s at the file level (see the
 * deploy/nginx.conf.template alias block), so the rename IS the
 * privacy switch — no DB column, no JSON edit, no sync required.
 *
 * Simpler than the find/map anonymize actions:
 *   - No paired file to also rename (donation photos have no crop).
 *   - No LokaceStavyPoznamky.json to keep in lockstep.
 *   - No sync-needed banner — `find-photos/` is filesystem-only and
 *     the public reader picks the new name up on the next request
 *     once `invalidateFindPhotosCache()` runs.
 *
 * Single-click both directions (no confirm step): the action only
 * affects one specific photo, the file stays on disk either way,
 * and flipping it back is a single click — same low-stakes profile
 * as the maps anon toggle.
 */
export async function setDonationPhotoAnonymized(
  formData: FormData,
): Promise<AnonymizeDonationPhotoResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, filename: "?", error: "Unauthenticated" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const rawName = formData.get("name");
  const rawAnon = formData.get("anonymize");
  if (typeof rawName !== "string" || rawName.length === 0) {
    return { ok: false, filename: "?", error: "Missing name" };
  }
  if (rawAnon !== "1" && rawAnon !== "0") {
    return {
      ok: false,
      filename: rawName,
      error: "Field `anonymize` must be '0' or '1'",
    };
  }
  const anonymize = rawAnon === "1";

  let baseName: string;
  try {
    baseName = safeBaseName(rawName);
  } catch (err) {
    return { ok: false, filename: rawName, error: (err as Error).message };
  }

  const resolved = await resolveDiskPath("donationPhotos", baseName);
  if (!resolved) {
    return { ok: false, filename: baseName, error: "Soubor neexistuje" };
  }

  const m = FILENAME_RE.exec(resolved.name);
  if (!m) {
    return {
      ok: false,
      filename: resolved.name,
      error: `Název neodpovídá vzoru "<id><slot>_DAR[_ANON].<ext>".`,
    };
  }
  const findId = Number(m[1]);
  const slot = m[2]!.toLowerCase();
  const isCurrentlyAnon = m[3] !== undefined;
  const ext = m[4]!.toLowerCase();

  if (isCurrentlyAnon === anonymize) {
    return {
      ok: false,
      filename: resolved.name,
      error: anonymize
        ? "Fotka už je anonymizovaná (_ANON v názvu)."
        : "Fotka už není anonymizovaná.",
    };
  }

  const newName = anonymize
    ? `${findId}${slot}_DAR_ANON.${ext}`
    : `${findId}${slot}_DAR.${ext}`;
  if (newName === resolved.name) {
    // Shouldn't be reachable — the isCurrentlyAnon === anonymize
    // check above already guarantees a real change. Defensive guard
    // for the case where the regex matches but the rebuild somehow
    // produced the same string.
    return {
      ok: false,
      filename: resolved.name,
      error: "Nový název vyšel shodně se starým.",
    };
  }

  let newAbs: string;
  try {
    newAbs = safeJoin("donationPhotos", newName);
  } catch (err) {
    return {
      ok: false,
      filename: resolved.name,
      error: (err as Error).message,
    };
  }
  if (await fileExists(newAbs)) {
    return {
      ok: false,
      filename: resolved.name,
      error: `Cíl "${newName}" už existuje.`,
    };
  }

  await fs.rename(resolved.absolutePath, newAbs);

  await appendAudit({
    action: "file.rename",
    ip,
    credentialLabel,
    details: {
      scope: "donation-photos",
      from: resolved.name,
      to: newName,
      reason: anonymize ? "anonymize-on" : "anonymize-off",
      findId,
      slot,
    },
  });

  // Bust the on-disk findPhotos index so /sbirka/<id>'s modal and
  // the admin find-detail card both see the new state on the next
  // request. Then revalidate the two detail-page paths (old + new)
  // so RSC re-renders either URL the user lands on.
  invalidateFindPhotosCache();
  revalidatePath("/admin/files/donation-photos");
  revalidatePath(
    `/admin/files/donation-photos/${encodeURIComponent(resolved.name)}`,
  );
  revalidatePath(
    `/admin/files/donation-photos/${encodeURIComponent(newName)}`,
  );
  // The find-detail card on /admin/files/finds/<find> lists every
  // donation photo for the find with an `isAnonymized` badge —
  // bust its parent layout so the card re-renders with the flipped
  // state.
  revalidatePath("/admin/files/finds", "layout");
  // Public ISR cache for the find's detail page — same call shape
  // the upload action uses so the public unlock flow picks up the
  // new state without waiting for the 24 h revalidation.
  revalidatePath("/sbirka", "layout");

  return {
    ok: true,
    filename: resolved.name,
    newFilename: newName,
  };
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}
