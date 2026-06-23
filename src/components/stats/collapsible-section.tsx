"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Collapsible card for /statistiky sections. Native `<details>` so it
 * works without JS — the title (+ optional subtitle) sit in the
 * always-visible `<summary>`, the body collapses.
 *
 * Open/closed is remembered for the session (sessionStorage, keyed by
 * `storageKey`) so returning to or reloading /statistiky doesn't keep
 * re-collapsing what the visitor opened. SSR can't read sessionStorage,
 * so the first paint uses `defaultOpen` and an effect corrects it after
 * hydration.
 *
 * `title` accepts a node so client callers (Top-locations / Top-finds)
 * can pass a state-dependent heading and keep their interactive toggles
 * in the body. Brand-tinted tile background to match the rest of the
 * page's stat tiles.
 */

const STORAGE_PREFIX = "statistiky.collapse.";

export function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  storageKey,
  id,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  defaultOpen?: boolean;
  storageKey: string;
  /** Anchor id for deep-linking. When the page is opened with
   *  `#<id>` in the URL (e.g. the home popular widget linking to
   *  `/statistiky#top-finds`), the section force-opens and scrolls
   *  itself into view, overriding the remembered collapsed state. */
  id?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (id && window.location.hash.slice(1) === id) {
      setOpen(true);
      const el = document.getElementById(id);
      if (el) {
        // Let the <details> paint open before scrolling to it.
        const tmo = setTimeout(
          () => el.scrollIntoView({ behavior: "smooth", block: "start" }),
          60,
        );
        return () => clearTimeout(tmo);
      }
      return;
    }
    try {
      const v = sessionStorage.getItem(STORAGE_PREFIX + storageKey);
      if (v === "1") setOpen(true);
      else if (v === "0") setOpen(false);
    } catch {
      /* sessionStorage unavailable — keep defaultOpen */
    }
  }, [storageKey, id]);

  return (
    <details
      id={id}
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (next === open) return;
        setOpen(next);
        try {
          sessionStorage.setItem(STORAGE_PREFIX + storageKey, next ? "1" : "0");
        } catch {
          /* ignore */
        }
      }}
      // Named group ("section") so a nested unnamed `group` details
      // inside the body (e.g. jubilee "show more", calendar value
      // tables) keeps its own `group-open:` scope instead of reacting
      // to this card's open state.
      className="group/section scroll-mt-24 rounded-xl border border-gray-200 bg-gray-50 p-5"
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          {typeof title === "string" ? (
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          ) : (
            title
          )}
          {subtitle && (
            <div className="mt-0.5 text-sm text-gray-600">{subtitle}</div>
          )}
        </div>
        <ChevronDown
          className="mt-1 h-5 w-5 shrink-0 text-gray-400 transition group-open/section:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}
