"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { NavLink } from "@/components/nav-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { SITE_NAME } from "@/lib/constants";

const NAV_ITEMS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/", label: "Domů" },
  { href: "/sbirka", label: "Sbírka" },
  { href: "/lokality", label: "Lokality" },
  { href: "/mapa", label: "Mapa" },
  { href: "/statistiky", label: "Statistiky" },
];

/**
 * Top-of-page header with adaptive navigation. On md+ screens the nav
 * items render inline as before. On smaller widths the brand + nav
 * couldn't fit in one row and the original `flex-wrap` made every
 * item drop to its own line — instead a hamburger toggle now reveals
 * a dropdown panel with the same NavLinks stacked vertically.
 *
 * The menu auto-closes whenever the route changes (a NavLink click
 * navigates, the pathname effect fires, the panel collapses) so the
 * user doesn't end up on a new page with the menu still open.
 */
export function MainNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile panel on every navigation. Runs after the new
  // route has rendered, so by the time the user sees the new page the
  // header is already collapsed back to the compact bar.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

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
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <NavLink href={item.href}>{item.label}</NavLink>
              </li>
            ))}
          </ul>
          <ThemeToggle />
        </div>

        {/* Compact mobile actions — keep ThemeToggle visible since it's
            small and useful, hide the rest behind a hamburger. */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={mobileOpen ? "Zavřít menu" : "Otevřít menu"}
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
          <ul className="mx-auto flex max-w-7xl flex-col gap-0.5 px-4 py-2 sm:px-6">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <NavLink href={item.href}>{item.label}</NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
