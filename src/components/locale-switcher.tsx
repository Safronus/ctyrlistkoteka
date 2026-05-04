"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useTransition } from "react";
import type { Locale } from "@/i18n/routing";
import { routing } from "@/i18n/routing";

/**
 * Compact CZ ⇄ EN toggle for the public header.
 *
 * Uses next-intl's locale-aware navigation so the switch preserves
 * the visitor's current path: `/sbirka/123` → `/en/sbirka/123` and
 * back. The default locale is prefix-free (`/sbirka`), so flipping
 * back to Czech drops the `/en` prefix automatically.
 *
 * Wrapped in `useTransition` so the route transition runs concurrently
 * with the locale switch — the visitor doesn't see a "stuck" button
 * during the rewrite.
 */
export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const switchTo = (next: Locale) => {
    if (next === locale) return;
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  };

  return (
    <div
      role="group"
      aria-label="Jazyk / Language"
      className="inline-flex items-center rounded-md border border-gray-200 bg-white text-xs"
    >
      {routing.locales.map((loc, i) => {
        const active = loc === locale;
        const base =
          "px-2 py-1 font-medium uppercase tracking-wide transition";
        const variant = active
          ? "bg-brand-600 text-white cursor-default"
          : "text-gray-600 hover:bg-brand-50 hover:text-brand-700";
        const radius =
          i === 0 ? "rounded-l-[5px]" : "rounded-r-[5px] border-l border-gray-200";
        return (
          <button
            key={loc}
            type="button"
            onClick={() => switchTo(loc)}
            disabled={active || isPending}
            aria-pressed={active}
            className={`${base} ${variant} ${radius} disabled:cursor-not-allowed`}
          >
            {loc}
          </button>
        );
      })}
    </div>
  );
}
