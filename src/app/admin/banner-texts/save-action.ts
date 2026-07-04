"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { appendAudit } from "@/lib/admin/audit";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import {
  isBannerTextKey,
  writeBannerTextOverride,
  type BannerTextKey,
} from "@/lib/bannerTextOverrides";

export interface SetBannerTextResult {
  ok: boolean;
  error?: string;
}

/**
 * Upsert an override for one find-photo banner (CS + EN) in
 * `data/.admin/banner-texts.json`. A variant is stored only when it's
 * non-empty AND differs from the current `FindDetail` i18n default, so:
 *   - saving unchanged text keeps the banner on the shared default (future
 *     default edits still propagate),
 *   - clearing a field, or typing the exact default back, removes the
 *     override for that locale.
 */
export async function setBannerTextOverride(
  formData: FormData,
): Promise<SetBannerTextResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) return { ok: false, error: "Unauthenticated" };
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const rawKey = formData.get("key");
  if (!isBannerTextKey(rawKey)) return { ok: false, error: "Neznámý banner" };
  const key: BannerTextKey = rawKey;

  const cs =
    typeof formData.get("cs") === "string" ? String(formData.get("cs")) : "";
  const en =
    typeof formData.get("en") === "string" ? String(formData.get("en")) : "";

  // Compare against the baked-in defaults so an unchanged save is a no-op
  // (the banner keeps tracking the message catalogue).
  const [tCs, tEn] = await Promise.all([
    getTranslations({ locale: "cs", namespace: "FindDetail" }),
    getTranslations({ locale: "en", namespace: "FindDetail" }),
  ]);
  const defCs = tCs(key).trim();
  const defEn = tEn(key).trim();

  const ovCs = cs.trim() && cs.trim() !== defCs ? cs.trim() : undefined;
  const ovEn = en.trim() && en.trim() !== defEn ? en.trim() : undefined;

  try {
    await writeBannerTextOverride(key, { cs: ovCs, en: ovEn });
  } catch (err) {
    return { ok: false, error: `Uložení selhalo: ${(err as Error).message}` };
  }

  await appendAudit({
    action: "json.update",
    ip,
    credentialLabel,
    details: {
      scope: "banner-text-override",
      key,
      hasCs: ovCs !== undefined,
      hasEn: ovEn !== undefined,
    },
  });

  revalidatePath("/admin/banner-texts");
  // Regenerate the public find pages (all locales) so the banners update.
  revalidatePath("/[locale]/sbirka/[id]", "page");

  return { ok: true };
}
