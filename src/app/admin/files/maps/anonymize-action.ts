"use server";

import { promises as fs } from "node:fs";
import { revalidatePath } from "next/cache";
import { atomicWrite } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { safeBaseName } from "@/lib/admin/paths";
import { setPngTextTag } from "@/lib/admin/pngTextEdit";
import { resolveDiskPath } from "@/lib/admin/scopes";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";

/** Canonical keyword we write into the PNG when marking a map
 *  anonymised. The reader (`readAnonymizedFlag` in images.ts) matches
 *  by normalised keyword, so this exact spelling is the one that
 *  round-trips with whatever Map Marker / exiftool wrote first. */
const ANON_KEYWORD = "Anonymizovaná lokace";
const ANON_VALUE_YES = "Ano";

/** Toggles the anonymisation tag on a single location-map PNG.
 *  `anonymize=true` writes `Anonymizovaná lokace=Ano` (replacing any
 *  existing tag with a normalised-equivalent keyword); `false` strips
 *  every matching tEXt/iTXt chunk so the file decodes as un-flagged.
 *
 *  Atomic on disk (tmp → fsync → rename) so a reader can't catch a
 *  partial PNG. The byte change is just a chunk add/remove — IDAT
 *  pixels stay intact, so the rendered map looks identical, only its
 *  metadata differs. Sync's `phaseMaps` re-reads the metadata on
 *  every run, so the next sync will mirror the new state into
 *  `LocationMap.isAnonymized` without any further wiring. */
export async function setMapAnonymized(
  formData: FormData,
): Promise<{
  ok: boolean;
  filename: string;
  anonymized?: boolean;
  removed?: number;
  added?: number;
  error?: string;
}> {
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
    return {
      ok: false,
      filename: rawName,
      error: (err as Error).message,
    };
  }

  const resolved = await resolveDiskPath("locationMaps", baseName);
  if (!resolved) {
    return { ok: false, filename: baseName, error: "Soubor neexistuje" };
  }

  let buf: Buffer;
  try {
    buf = await fs.readFile(resolved.absolutePath);
  } catch (err) {
    return {
      ok: false,
      filename: resolved.name,
      error: `Čtení selhalo: ${(err as Error).message}`,
    };
  }

  let edit;
  try {
    edit = setPngTextTag(
      buf,
      ANON_KEYWORD,
      anonymize ? ANON_VALUE_YES : null,
    );
  } catch (err) {
    return {
      ok: false,
      filename: resolved.name,
      error: (err as Error).message,
    };
  }

  // No-op detection: nothing to do if the tag is already in the
  // requested state (no matching chunk to remove and we're turning
  // off, OR a matching chunk exists and we're turning on without
  // changing the value). We still rewrite the file in the "on" case
  // because the value might differ from "Ano" (foreign tooling could
  // have used "Yes"); the rewrite normalises it to our canonical form.
  if (!anonymize && edit.removed === 0) {
    return {
      ok: true,
      filename: resolved.name,
      anonymized: false,
      removed: 0,
      added: 0,
    };
  }

  try {
    await atomicWrite(resolved.absolutePath, edit.buffer);
  } catch (err) {
    return {
      ok: false,
      filename: resolved.name,
      error: `Zápis selhal: ${(err as Error).message}`,
    };
  }

  await appendAudit({
    action: "file.replace",
    ip,
    credentialLabel,
    details: {
      scope: "maps",
      file: resolved.name,
      reason: anonymize ? "anonymize-on" : "anonymize-off",
      keyword: ANON_KEYWORD,
      removed_chunks: edit.removed,
      added_chunks: edit.added,
    },
  });

  // Refresh both listing + detail so the badge + filter chip update.
  revalidatePath("/admin/files/maps");
  revalidatePath(`/admin/files/maps/${encodeURIComponent(resolved.name)}`);

  return {
    ok: true,
    filename: resolved.name,
    anonymized: anonymize,
    removed: edit.removed,
    added: edit.added,
  };
}
