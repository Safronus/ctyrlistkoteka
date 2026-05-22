"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";

/** Shared "items per page" dropdown used at the bottom of paginated
 *  list pages (/sbirka, /lokality).
 *
 *  The component is `"use client"` (uses `useRouter` + `useTransition`),
 *  so server callers MUST NOT pass a function as a prop — that's a
 *  hard RSC error: "Functions cannot be passed directly to Client
 *  Components unless you explicitly expose it by marking it with
 *  'use server'." Instead, the server pre-computes a destination URL
 *  for every option (size → href map) and the client just picks one
 *  on change. Mirrors the rule documented in docs/gotchas.md §2.
 *
 *  The select wraps in a label for screen-reader accessibility; on
 *  narrow viewports the "Záznamů na stránku" label hides under sm so
 *  the trigger stays compact (matches the LocationsToolbar pattern). */
export function PageSizeSelector({
  current,
  options,
  hrefsBySize,
}: {
  /** Currently selected page size. Renders the option as selected. */
  current: number;
  /** Allowed sizes in display order. Each becomes one <option>. */
  options: readonly number[];
  /** Pre-computed destination URLs keyed by option size. Server is
   *  responsible for building each entry with all other URL params
   *  preserved (search, sort, filters) and `?page=1` (the current
   *  page index is meaningless under a different size). */
  hrefsBySize: Readonly<Record<number, string>>;
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
          const href = hrefsBySize[next];
          if (!href) return;
          startTransition(() => {
            router.push(href);
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
