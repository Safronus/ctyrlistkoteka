"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";

/** Shared "items per page" dropdown used at the bottom of paginated
 *  list pages (/sbirka, /lokality).
 *
 *  The component owns no URL building — callers pass `makeHref(size)`
 *  that returns the path-with-query-string for the new selection.
 *  Mirrors the pattern of the `Pagination` component next to it so
 *  size + page navigation stay decoupled from page-specific filter
 *  state. The new URL is pushed via the locale-aware app-router so
 *  ISR / RSC re-fetches happen the same way as for Pagination clicks.
 *
 *  The select wraps in a label for screen-reader accessibility; on
 *  narrow viewports the "Záznamů na stránku" label hides under sm so
 *  the trigger stays compact (matches the LocationsToolbar pattern). */
export function PageSizeSelector({
  current,
  options,
  makeHref,
}: {
  /** Currently selected page size. Renders the option as selected. */
  current: number;
  /** Allowed sizes in display order. Each becomes one <option>. */
  options: readonly number[];
  /** Builds the destination URL for the given size. The caller is
   *  responsible for preserving all other URL params (search, sort,
   *  filters) and for resetting `?page` to 1 — changing the page
   *  size invalidates the current page index. */
  makeHref: (size: number) => string;
}) {
  const t = useTranslations("Pagination");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <label
      className={`inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-2.5 text-sm text-gray-700 transition ${
        isPending ? "opacity-60" : ""
      }`}
      aria-label={t("pageSizeAria")}
    >
      <span className="hidden text-gray-500 sm:inline">
        {t("pageSizeLabel")}:
      </span>
      <select
        value={current}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (!Number.isFinite(next) || next === current) return;
          startTransition(() => {
            router.push(makeHref(next));
          });
        }}
        className="cursor-pointer border-0 bg-transparent pr-1 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}
