"use client";

import Image from "next/image";
import { Link, usePathname } from "@/i18n/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { NavLink } from "@/components/nav-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SITE_NAME } from "@/lib/constants";

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
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const items = NAV_HREFS.map((it) => ({ ...it, label: t(it.key) }));

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 text-lg font-semibold text-brand-700"
        >
          <Image
            src="/clover.png"
            alt=""
            aria-hidden
            width={36}
            height={36}
            priority
            className="h-9 w-9"
          />
          <span>{SITE_NAME}</span>
        </Link>

        {/* Desktop nav — md+ only. */}
        <div className="hidden items-center gap-3 md:flex">
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

        {/* Compact mobile actions. */}
        <div className="flex items-center gap-2 md:hidden">
          <LocaleSwitcher />
          <ThemeToggle />
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
        </div>
      </nav>

      {mobileOpen && (
        <div
          id="main-nav-mobile-panel"
          className="border-t border-gray-200 bg-white md:hidden"
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
