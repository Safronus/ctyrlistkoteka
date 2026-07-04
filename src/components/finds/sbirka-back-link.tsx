"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";

/**
 * Preserves the visitor's current /sbirka filter state across the
 * detail-page round-trip. The list page mounts `RememberSbirkaSearch`
 * which writes the current query string into sessionStorage on every
 * URL change; the detail page renders `BackToSbirkaLink` which reads
 * the stored value and points "Zpět na sbírku" back to the same
 * filtered view.
 *
 * sessionStorage (not localStorage) means it's per-tab — closing the
 * tab clears the memory, so a fresh tab opens at unfiltered /sbirka
 * by default. This matches CLAUDE.md §3's allowance for UI-preference
 * client storage and avoids long-lived state surprising the user.
 */

const KEY = "sbirka.last-search";

export function RememberSbirkaSearch() {
  const searchParams = useSearchParams();

  useEffect(() => {
    try {
      const search = searchParams.toString();
      if (search) {
        window.sessionStorage.setItem(KEY, search);
      } else {
        // No filters → clear so the back link doesn't carry yesterday's
        // filter back into a fresh visit.
        window.sessionStorage.removeItem(KEY);
      }
    } catch {
      /* sessionStorage unavailable (private mode etc.) — silently skip */
    }
  }, [searchParams]);

  return null;
}

export function BackToSbirkaLink({
  variant = "text",
}: {
  /** "text" — full "← Zpět na sbírku" link (default). "icon" — a bare
   *  ← arrow (subtle, for the desktop detail bar). "button" — a bordered
   *  ← arrow chip matching the mobile app-bar hamburger. */
  variant?: "text" | "icon" | "button";
}) {
  const t = useTranslations("BackLink");
  // Initial render targets bare /sbirka so SSR markup is stable; the
  // client effect upgrades the href once it can read sessionStorage.
  // The user-visible label is unchanged so the brief mismatch is
  // invisible unless the visitor inspects the link before clicking.
  const [href, setHref] = useState("/sbirka");

  useEffect(() => {
    try {
      const search = window.sessionStorage.getItem(KEY);
      if (search) setHref(`/sbirka?${search}`);
    } catch {
      /* ignore */
    }
  }, []);

  // next-intl's `Link` auto-prepends `/en/` when rendered under the
  // English locale, so the same `href` resolves to the correct path
  // for both locales without per-call juggling.
  if (variant === "icon") {
    return (
      <Link
        href={href}
        aria-label={t("backAria")}
        title={t("backAria")}
        className="inline-flex items-center text-gray-500 transition hover:text-brand-700"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden />
      </Link>
    );
  }
  if (variant === "button") {
    return (
      <Link
        href={href}
        aria-label={t("backAria")}
        title={t("backAria")}
        className="inline-flex h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-sm font-medium text-gray-700 transition hover:border-brand-200 hover:text-brand-700"
      >
        <ArrowLeft className="h-5 w-5 shrink-0" aria-hidden />
        <span>{t("backShort")}</span>
      </Link>
    );
  }
  return (
    <Link href={href} className="hover:text-brand-700">
      {t("toCollection")}
    </Link>
  );
}
