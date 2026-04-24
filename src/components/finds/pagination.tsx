import Link from "next/link";

export function Pagination({
  page,
  totalPages,
  makeHref,
}: {
  page: number;
  totalPages: number;
  makeHref: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  const prev = Math.max(1, page - 1);
  const next = Math.min(totalPages, page + 1);

  return (
    <nav
      aria-label="Stránkování"
      className="flex items-center justify-between gap-3 border-t border-gray-200 pt-4"
    >
      <LinkOrDisabled
        href={makeHref(prev)}
        disabled={page <= 1}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
      >
        ← Předchozí
      </LinkOrDisabled>
      <p className="text-sm text-gray-600">
        Strana <strong>{page}</strong> z <strong>{totalPages}</strong>
      </p>
      <LinkOrDisabled
        href={makeHref(next)}
        disabled={page >= totalPages}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
      >
        Další →
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
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
