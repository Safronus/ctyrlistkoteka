"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { routing } from "@/i18n/routing";

/**
 * Compact CZ ⇄ EN toggle for the public header.
 *
 * Uses plain anchors instead of `router.replace`/`useTransition` —
 * next-intl 4.x with `localePrefix: 'as-needed'` and a shared
 * `[locale]/layout.tsx` reliably swaps the URL on client-side
 * navigation but doesn't always swap the `NextIntlClientProvider`
 * messages bundle. The visible symptom: switching EN → CS lands on
 * `/sbirka` but the page keeps rendering English strings until the
 * visitor manually reloads. Full-page navigation guarantees the
 * server re-runs with the right request locale and the messages
 * bundle ships fresh.
 *
 * Trade-off: we lose Next.js link prefetching for the locale toggle
 * itself, which is fine — visitors don't hover-prefetch a language
 * pill the way they do nav items, and we'd much rather have correct
 * rendering than a sub-second pre-warm.
 */
export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const t = useTranslations("Nav");
  // `usePathname` from next-intl strips the locale prefix, so on
  // `/en/sbirka/123` we get `/sbirka/123`. We re-add the prefix
  // ourselves below for non-default locales, and drop it entirely
  // for the default (cs) — matching `localePrefix: 'as-needed'`.
  const pathname = usePathname();

  const buildHref = (next: Locale): string => {
    const tail = pathname === "/" ? "" : pathname;
    if (next === routing.defaultLocale) {
      return tail || "/";
    }
    return `/${next}${tail}`;
  };

  return (
    <div
      role="group"
      aria-label={`${t("localeAria")} / Language`}
      className="inline-flex items-center rounded-md border border-gray-200 bg-white text-xs"
    >
      {routing.locales.map((loc, i) => {
        const active = loc === locale;
        const fullLabel = loc === "cs" ? t("localeCs") : t("localeEn");
        // h-8 matches the ThemeToggle's overall height (h-7 buttons +
        // p-0.5 padding) so the two pills read as the same size in both
        // the desktop nav and the mobile second row.
        const base =
          "inline-flex h-8 items-center px-2 font-medium uppercase tracking-wide transition";
        const variant = active
          ? "bg-brand-600 text-white cursor-default"
          : "text-gray-600 hover:bg-brand-50 hover:text-brand-700";
        const radius =
          i === 0
            ? "rounded-l-[5px]"
            : "rounded-r-[5px] border-l border-gray-200";
        const className = `${base} ${variant} ${radius}`;
        if (active) {
          // Active locale renders as a non-interactive <span> — no
          // navigation possible, and `aria-current="true"` tells
          // assistive tech which side is selected without overloading
          // a button's pressed state.
          return (
            <span
              key={loc}
              aria-current="true"
              title={fullLabel}
              className={className}
            >
              {loc}
            </span>
          );
        }
        return (
          <a
            key={loc}
            href={buildHref(loc)}
            title={fullLabel}
            aria-label={fullLabel}
            className={className}
          >
            {loc}
          </a>
        );
      })}
    </div>
  );
}
