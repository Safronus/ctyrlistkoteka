import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** Build the visible page sequence for the windowed page list:
 *  always include 1, totalPages and the current page ±1, plus a tiny
 *  pad near each end so the user gets a real list (2, 3, …) instead
 *  of a lonely "1 …" jump when current is near the edge.
 *
 *  Returns numbers and "…" placeholders in display order. */
function buildPageWindow(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const window = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  if (page <= 3) {
    window.add(2);
    window.add(3);
    window.add(4);
  }
  if (page >= totalPages - 2) {
    window.add(totalPages - 1);
    window.add(totalPages - 2);
    window.add(totalPages - 3);
  }
  const sorted = [...window]
    .filter((n) => n >= 1 && n <= totalPages)
    .sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && (sorted[i] as number) - (sorted[i - 1] as number) > 1) {
      out.push("…");
    }
    out.push(sorted[i] as number);
  }
  return out;
}

export function Pagination({
  page,
  totalPages,
  makeHref,
  rightSlot,
}: {
  page: number;
  totalPages: number;
  /** The href builder receives a 1-based page number and returns the
   *  query-stringed `/sbirka` URL. We strip the leading `/sbirka`
   *  prefix here because next-intl's `Link` accepts route-relative
   *  paths and applies the locale prefix itself. */
  makeHref: (page: number) => string;
  /** Optional content rendered to the immediate left of "Next" — used
   *  on /sbirka to inline the page-size selector with the nav row.
   *  Pass `null` (or omit) to keep the simple Prev / pages / Next
   *  layout. */
  rightSlot?: React.ReactNode;
}) {
  const t = useTranslations("Pagination");
  if (totalPages <= 1) return null;

  const prev = Math.max(1, page - 1);
  const next = Math.min(totalPages, page + 1);
  const window = buildPageWindow(page, totalPages);

  const stepCls =
    "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50";
  const numberBase =
    "inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-md px-2 text-sm tabular-nums";
  const numberInactive = `${numberBase} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`;
  const numberActive = `${numberBase} border border-brand-500 bg-brand-50 font-semibold text-brand-800`;
  const ellipsis = `${numberBase} cursor-default border border-transparent text-gray-400`;

  return (
    <nav
      aria-label={t("navLabel")}
      className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-4"
    >
      <LinkOrDisabled href={makeHref(prev)} disabled={page <= 1} className={stepCls}>
        {t("prev")}
      </LinkOrDisabled>

      <ol className="flex flex-wrap items-center gap-1">
        {window.map((item, idx) => {
          if (item === "…") {
            return (
              <li key={`gap-${idx}`}>
                <span className={ellipsis} aria-hidden>
                  …
                </span>
              </li>
            );
          }
          if (item === page) {
            return (
              <li key={item}>
                <span aria-current="page" className={numberActive}>
                  {item}
                </span>
              </li>
            );
          }
          return (
            <li key={item}>
              <Link
                href={makeHref(item)}
                aria-label={t("pageAria", { page: item })}
                className={numberInactive}
              >
                {item}
              </Link>
            </li>
          );
        })}
      </ol>

      <div className="ml-auto flex items-center gap-2">
        {rightSlot}
        <LinkOrDisabled
          href={makeHref(next)}
          disabled={page >= totalPages}
          className={stepCls}
        >
          {t("next")}
        </LinkOrDisabled>
      </div>
    </nav>
  );
}

function LinkOrDisabled({
  href,
  disabled,
  children,
  className,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
  className: string;
}) {
  if (disabled) {
    return (
      <span className={`${className} cursor-not-allowed opacity-40`}>
        {children}
      </span>
    );
  }
  // next-intl's `Link` infers locale from context; the href can be a
  // string with query params and gets the `/<locale>/` prefix added
  // automatically when rendered on a non-default locale.
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
