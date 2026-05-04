import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function Pagination({
  page,
  totalPages,
  makeHref,
}: {
  page: number;
  totalPages: number;
  /** The href builder receives a 1-based page number and returns the
   *  query-stringed `/sbirka` URL. We strip the leading `/sbirka`
   *  prefix here because next-intl's `Link` accepts route-relative
   *  paths and applies the locale prefix itself. */
  makeHref: (page: number) => string;
}) {
  const t = useTranslations("Pagination");
  if (totalPages <= 1) return null;

  const prev = Math.max(1, page - 1);
  const next = Math.min(totalPages, page + 1);

  return (
    <nav
      aria-label={t("navLabel")}
      className="flex items-center justify-between gap-3 border-t border-gray-200 pt-4"
    >
      <LinkOrDisabled
        href={makeHref(prev)}
        disabled={page <= 1}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
      >
        {t("prev")}
      </LinkOrDisabled>
      <p className="text-sm text-gray-600">
        {t.rich("pageOf", {
          page,
          totalPages,
          b: (chunks) => <strong>{chunks}</strong>,
        })}
      </p>
      <LinkOrDisabled
        href={makeHref(next)}
        disabled={page >= totalPages}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
      >
        {t("next")}
      </LinkOrDisabled>
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
