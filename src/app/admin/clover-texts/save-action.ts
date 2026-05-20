"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { atomicWrite, ensureDir, trashTimestamp } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { formatJsonCompactArrays } from "@/lib/admin/jsonFormat";
import {
  CLOVER_TEXTS_FILENAME,
  CLOVER_TRANSLATIONS_FILENAME,
  cloverTextsFileSchema,
  cloverTranslationsFileSchema,
} from "@/lib/admin/jsonSchema";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";

export interface SaveResult {
  ok: boolean;
  /** ISO timestamp on success — the client uses it to render a
   *  "Uloženo HH:MM:SS" toast. */
  savedAt?: string;
  /** Top-level error message when the save failed for a reason that
   *  isn't tied to a particular field. */
  error?: string;
  /** Field-level Zod issues. `which` distinguishes CZ vs EN to direct
   *  the editor to the right side of the form. */
  issues?: { which: "cs" | "en"; path: (string | number)[]; message: string }[];
}

const TEXTS_PATH = path.join(ADMIN_ROOTS.meta, CLOVER_TEXTS_FILENAME);
const TRANSLATIONS_PATH = path.join(
  ADMIN_ROOTS.meta,
  CLOVER_TRANSLATIONS_FILENAME,
);

/** Server action invoked from the editor. Receives full state for
 *  both files as JSON strings, validates both, atomically writes both,
 *  and snapshots the previous versions into `data/.trash/<ts>/meta/`.
 *
 *  We accept JSON strings (rather than reconstructed objects) so the
 *  shape that lands on disk is exactly what the client produced —
 *  formatting and key order match what the editor preview shows. */
export async function saveCloverTexts(formData: FormData): Promise<SaveResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, error: "Unauthenticated" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const rawCs = formData.get("textsCs");
  const rawEn = formData.get("translationsEn");
  if (typeof rawCs !== "string" || typeof rawEn !== "string") {
    return { ok: false, error: "Chybí pole `textsCs` nebo `translationsEn`" };
  }

  let parsedCs: unknown;
  let parsedEn: unknown;
  try {
    parsedCs = JSON.parse(rawCs);
  } catch (err) {
    return {
      ok: false,
      error: `CZ JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  try {
    parsedEn = JSON.parse(rawEn);
  } catch (err) {
    return {
      ok: false,
      error: `EN JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const csResult = cloverTextsFileSchema.safeParse(parsedCs);
  if (!csResult.success) {
    return {
      ok: false,
      issues: csResult.error.issues.map((i) => ({
        which: "cs" as const,
        path: [...i.path] as (string | number)[],
        message: i.message,
      })),
    };
  }
  const enResult = cloverTranslationsFileSchema.safeParse(parsedEn);
  if (!enResult.success) {
    return {
      ok: false,
      issues: enResult.error.issues.map((i) => ({
        which: "en" as const,
        path: [...i.path] as (string | number)[],
        message: i.message,
      })),
    };
  }

  // Re-serialise from validated data so we drop any unknown top-level
  // keys + normalise whitespace + keep diff-friendly formatting.
  const csFormatted = formatJsonCompactArrays(csResult.data) + "\n";
  const enFormatted = formatJsonCompactArrays(enResult.data) + "\n";

  // Snapshot both files into a single trash bucket so a single restore
  // brings them back in lockstep — they're paired data.
  const trashDir = path.join(ADMIN_ROOTS.trash, trashTimestamp(), "meta");
  for (const [src, name] of [
    [TEXTS_PATH, CLOVER_TEXTS_FILENAME],
    [TRANSLATIONS_PATH, CLOVER_TRANSLATIONS_FILENAME],
  ] as const) {
    try {
      await fs.access(src);
      await ensureDir(trashDir);
      await fs.copyFile(src, path.join(trashDir, name));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[admin/json] clover backup failed", { name, message });
        return { ok: false, error: `Backup do .trash selhal: ${message}` };
      }
    }
  }

  await ensureDir(ADMIN_ROOTS.meta);
  await atomicWrite(TEXTS_PATH, csFormatted);
  await atomicWrite(TRANSLATIONS_PATH, enFormatted);

  await appendAudit({
    action: "json.update",
    ip,
    credentialLabel,
    details: {
      file: `${CLOVER_TEXTS_FILENAME} + ${CLOVER_TRANSLATIONS_FILENAME}`,
      textsBytes: Buffer.byteLength(csFormatted, "utf8"),
      translationsBytes: Buffer.byteLength(enFormatted, "utf8"),
      textCount: csResult.data.texts.length,
      translationCount: Object.keys(enResult.data.translations).length,
    },
  });

  // Homepage caches the clover lookup per-mtime; the next request will
  // see the new mtime and re-read. We still revalidate the home path
  // so ISR doesn't serve stale HTML.
  revalidatePath("/", "layout");
  revalidatePath("/admin/clover-texts");
  return { ok: true, savedAt: new Date().toISOString() };
}
