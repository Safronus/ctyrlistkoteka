"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { atomicWrite, ensureDir, trashTimestamp } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { ADMIN_ROOTS, safeBaseName } from "@/lib/admin/paths";
import { setPngTextTag } from "@/lib/admin/pngTextEdit";
import { resolveDiskPath } from "@/lib/admin/scopes";
import { cascadeMapAnon, type AnonCascadeResult } from "@/lib/admin/anonCascade";
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
  /** How many find IDs the cascade added/removed in
   *  LokaceStavyPoznamky.json anonymizace.ANONYMIZOVANE. */
  jsonFindsAdded?: number;
  jsonFindsRemoved?: number;
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

  // Snapshot the current PNG before the in-place rewrite (§9c), same shape
  // as delete/replace: data/.trash/<ts>/maps/<name>. The edit only toggles a
  // tEXt metadata chunk (reversible by toggling back), but keep the trash
  // trail uniform with every other destructive map op. Fail closed: if the
  // backup can't be written we do NOT overwrite the original.
  try {
    const trashDir = path.join(ADMIN_ROOTS.trash, trashTimestamp(), "maps");
    await ensureDir(trashDir);
    await fs.copyFile(
      resolved.absolutePath,
      path.join(trashDir, resolved.name),
    );
  } catch (err) {
    return {
      ok: false,
      filename: resolved.name,
      error: `Záloha do koše selhala: ${(err as Error).message}`,
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

  // Cascade to the location's finds: rename their photo files (pole 5) and
  // mirror into LokaceStavyPoznamky.json. Non-fatal — the PNG tag is the
  // source of truth and sync enforces the same rule regardless (see
  // cascadeMapAnon / phaseMeta).
  let cascade: AnonCascadeResult;
  try {
    cascade = await cascadeMapAnon(resolved.name, anonymize);
  } catch (err) {
    cascade = {
      changed: false,
      photosRenamed: 0,
      jsonAdded: [],
      jsonRemoved: [],
      errors: [],
      skipped: `error: ${(err as Error).message}`,
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
      cascade_photos_renamed: cascade.photosRenamed,
      cascade_json_added: cascade.jsonAdded.length,
      cascade_json_removed: cascade.jsonRemoved.length,
      cascade_errors: cascade.errors.length,
      cascade_skipped: cascade.skipped ?? null,
    },
  });

  // Refresh listing + detail (badge/filter) and the JSON editor (the
  // cascade may have rewritten anonymizace.ANONYMIZOVANE).
  revalidatePath("/admin/files/maps");
  revalidatePath(`/admin/files/maps/${encodeURIComponent(resolved.name)}`);
  revalidatePath("/admin/json/lokace-stavy-poznamky");

  return {
    ok: true,
    filename: resolved.name,
    anonymized: anonymize,
    removed: edit.removed,
    added: edit.added,
    jsonFindsAdded: cascade.jsonAdded.length,
    jsonFindsRemoved: cascade.jsonRemoved.length,
  };
}
