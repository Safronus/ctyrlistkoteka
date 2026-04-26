"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

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

export function BackToSbirkaLink() {
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

  return (
    <Link href={href} className="hover:text-brand-700">
      ← Zpět na sbírku
    </Link>
  );
}
