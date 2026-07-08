"use client";

import { useState, type ReactNode } from "react";
import { Hourglass } from "lucide-react";

/**
 * Shared header for the filterable list pages (/sbirka, /lokality): the h1
 * (+ help dialog) on the left, and a filter-INDEPENDENT counts line pinned
 * to the right edge, on the same row as the title. The per-filter count now
 * lives in the "Filtr je aktivní …" strip below the filters, so this line
 * stays the stable "how big is the whole thing" summary.
 *
 * `notice` (+ `progressToggleLabel`) is optional: /sbirka passes its
 * "Sbírka se postupně doplňuje" banner behind a small hourglass toggle next
 * to the counts; /lokality has none, so it just shows the counts.
 */
export function FilterablePageHeader({
  children,
  counts,
  progressToggleLabel,
  notice,
}: {
  /** The h1 and (optionally) the HelpDialog — laid out on the left. */
  children: ReactNode;
  /** Filter-independent counts, right-aligned on the title row. */
  counts: ReactNode;
  /** aria/title for the hourglass toggle — only rendered (with `notice`)
   *  when both are present. */
  progressToggleLabel?: string;
  /** Collapsible notice revealed by the toggle (full width, below the row). */
  notice?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasNotice = !!notice && !!progressToggleLabel;

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-center gap-3">{children}</div>
        <p className="ml-auto inline-flex items-center gap-1.5 text-right text-sm text-gray-600">
          <span>{counts}</span>
          {hasNotice && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={progressToggleLabel}
              title={progressToggleLabel}
              className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition focus:outline-none focus:ring-2 focus:ring-amber-500/40 ${
                open
                  ? "bg-amber-100 text-amber-700"
                  : "text-amber-600 hover:bg-amber-50 hover:text-amber-700"
              }`}
            >
              <Hourglass className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </p>
      </div>
      {hasNotice && open && notice}
    </header>
  );
}
