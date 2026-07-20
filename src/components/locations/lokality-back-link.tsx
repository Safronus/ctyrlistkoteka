"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";

/**
 * Preserves the /lokality filter state across the detail-page round-trip —
 * the same pattern `sbirka-back-link.tsx` uses for /sbirka. The list page
 * mounts `RememberLokalitySearch`, which stores the current query string in
 * sessionStorage on every URL change; the detail page's "Zpět na seznam
 * lokalit" link (`BackToLokalityLink`) reads it and returns to the same
 * filtered view.
 *
 * sessionStorage (per-tab) matches CLAUDE.md §3's UI-preference allowance:
 * closing the tab forgets the filters, so a fresh tab opens unfiltered.
 */

const KEY = "lokality.last-search";

export function RememberLokalitySearch() {
  const searchParams = useSearchParams();

  useEffect(() => {
    try {
      const search = searchParams.toString();
      if (search) {
        window.sessionStorage.setItem(KEY, search);
      } else {
        // No filters → clear, so the back link doesn't resurrect an old
        // filter on a fresh visit.
        window.sessionStorage.removeItem(KEY);
      }
    } catch {
      /* sessionStorage unavailable (private mode etc.) — silently skip */
    }
  }, [searchParams]);

  return null;
}

export function BackToLokalityLink({
  label,
  className,
  children,
}: {
  /** Localized "Zpět na seznam lokalit" text (passed from the server page). */
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  // Start at bare /lokality so SSR markup is stable; the client effect
  // upgrades the href once it can read sessionStorage.
  const [href, setHref] = useState("/lokality");

  useEffect(() => {
    try {
      const search = window.sessionStorage.getItem(KEY);
      if (search) setHref(`/lokality?${search}`);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <Link
      href={href}
      className={
        className ??
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-gray-700 transition hover:bg-gray-100 hover:text-brand-700"
      }
    >
      {children ?? (
        <>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span>{label}</span>
        </>
      )}
    </Link>
  );
}
