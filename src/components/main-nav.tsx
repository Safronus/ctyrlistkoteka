"use client";

import Image from "next/image";
import { Link, usePathname } from "@/i18n/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { NavLink } from "@/components/nav-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { BackToSbirkaLink } from "@/components/finds/sbirka-back-link";
import { siteName } from "@/lib/siteName";

const NAV_HREFS: ReadonlyArray<{ href: string; key: string }> = [
  { href: "/", key: "home" },
  { href: "/sbirka", key: "sbirka" },
  { href: "/lokality", key: "lokality" },
  { href: "/mapa", key: "mapa" },
  { href: "/statistiky", key: "statistiky" },
];

/**
 * Top-of-page header with adaptive navigation.
 */
export function MainNav() {
  const t = useTranslations("Nav");
  const locale = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const items = NAV_HREFS.map((it) => ({ ...it, label: t(it.key) }));

  // On a find-detail page (`/sbirka/<id>`) phones get a compact "back to
  // collection" chip in the app bar (between the hamburger and the
  // locale/theme toggles) instead of the eye-catching link on the page.
  const isFindDetail = /^\/sbirka\/\d+$/.test(pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
      {/* Phones (< sm) stack the header on two rows — brand on top, the
          locale toggle + hamburger below — so the longer site name fits
          on one line. From sm up it's the usual single row. */}
      <nav className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex min-w-0 items-center justify-center gap-2 text-base font-semibold text-brand-700 sm:justify-start sm:text-lg"
        >
          <Image
            src="/clover.png"
            alt=""
            aria-hidden
            width={36}
            height={36}
            priority
            className="h-9 w-9 shrink-0"
          />
          <span className="truncate">{siteName(locale)}</span>
        </Link>

        {/* Desktop nav — only from 900px up. Below that the 5 inline
            links + locale + theme don't fit next to the (longer) brand
            and the list wrapped to a second row in the ~770–900px band;
            there we fall back to the hamburger instead. */}
        <div className="hidden items-center gap-3 min-[900px]:flex">
          <ul className="flex flex-wrap items-center gap-1">
            {items.map((item) => (
              <li key={item.href}>
                <NavLink href={item.href}>{item.label}</NavLink>
              </li>
            ))}
          </ul>
          <LocaleSwitcher />
          <ThemeToggle />
        </div>

        {/* Compact actions — shown below 900px (two-row stacked on
            phones < sm, single row above). Hamburger pinned left, locale
            + theme toggles grouped flush right; the drawer carries the
            nav links until the desktop nav appears at 900px. */}
        <div className="flex items-center justify-between gap-2 min-[900px]:hidden">
          {/* Hamburger + (on a find-detail page, phones only) the compact
              back chip, grouped together on the left with no gap between
              them. Locale + theme stay flush right. */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label={mobileOpen ? t("closeMenu") : t("openMenu")}
              aria-expanded={mobileOpen}
              aria-controls="main-nav-mobile-panel"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 transition hover:border-brand-200 hover:text-brand-700"
            >
              {mobileOpen ? (
                <X className="h-5 w-5" aria-hidden />
              ) : (
                <Menu className="h-5 w-5" aria-hidden />
              )}
            </button>
            {isFindDetail && (
              <div className="sm:hidden">
                <BackToSbirkaLink variant="button" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </nav>

      {mobileOpen && (
        <div
          id="main-nav-mobile-panel"
          className="border-t border-gray-200 bg-white min-[900px]:hidden"
        >
          <ul className="mx-auto flex max-w-7xl flex-col items-start gap-1 px-4 py-2 sm:px-6">
            {items.map((item) => (
              <li key={item.href}>
                <NavLink href={item.href} variant="compact">
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
