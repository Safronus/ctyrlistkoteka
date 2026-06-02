"use server";

import { revalidatePath } from "next/cache";
import { atomicWrite, ensureDir } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { homeRotationInputSchema } from "@/lib/homeRotation";
import {
  HOME_ROTATION_DIR,
  HOME_ROTATION_PATH,
} from "@/lib/homeRotation.server";

export interface SaveRotationResult {
  ok: boolean;
  /** ISO timestamp on success — the form renders a "Uloženo HH:MM:SS"
   *  confirmation. */
  savedAt?: string;
  /** Top-level error message. */
  error?: string;
  /** Per-field validation messages, keyed by the input name, so the
   *  form can highlight the offending field. */
  issues?: { field: string; message: string }[];
}

/** Reads one numeric form field; empty / missing → NaN so the schema
 *  rejects it with a clear message instead of silently coercing to 0. */
function readNumber(formData: FormData, key: string): number {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
}

/** Admin action: auth → validate the three second-values against their
 *  bounds → atomic write of `data/.admin/home-rotation.json` → audit →
 *  revalidate the public home so the new intervals take effect now
 *  rather than after the hourly ISR window. */
export async function saveHomeRotation(
  formData: FormData,
): Promise<SaveRotationResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, error: "Nepřihlášeno." };
  }
  const credentialLabel = session.credentialLabel;
  const ip = await getRequestIp();
  await touchSession();

  const parsed = homeRotationInputSchema.safeParse({
    cloverFactSeconds: readNumber(formData, "cloverFactSeconds"),
    randomFindSeconds: readNumber(formData, "randomFindSeconds"),
    screensaverSeconds: readNumber(formData, "screensaverSeconds"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: "Neplatné hodnoty — zkontroluj povolené rozsahy.",
      issues: parsed.error.issues.map((i) => ({
        field: String(i.path[0] ?? ""),
        message: i.message,
      })),
    };
  }

  const content = `${JSON.stringify(parsed.data, null, 2)}\n`;
  await ensureDir(HOME_ROTATION_DIR);
  await atomicWrite(HOME_ROTATION_PATH, content);

  await appendAudit({
    action: "settings.update",
    ip,
    credentialLabel,
    details: { file: "home-rotation.json", ...parsed.data },
  });

  // The public home is ISR-cached; revalidate the whole locale tree so
  // the new rotation props re-render on the next visit.
  revalidatePath("/", "layout");
  revalidatePath("/admin/settings");

  return { ok: true, savedAt: new Date().toISOString() };
}
