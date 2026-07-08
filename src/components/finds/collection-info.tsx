"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Hourglass } from "lucide-react";

/**
 * The total-count line under the /sbirka heading, with an optional
 * disclosure toggle for the "Sbírka se postupně doplňuje" notice.
 *
 * The notice used to sit permanently below the header; it's now
 * collapsed by default behind a small hourglass button next to the
 * count, so the page opens clean and the completeness caveat is one
 * click away for anyone who wants it. The banner itself is passed as
 * `children` (a server component) and only mounted once expanded.
 *
 * `hasNotice` is decided server-side (there's only something to reveal
 * when the catalog has a leading gap or internal holes AND no filter is
 * active); when false, neither the toggle nor the banner render.
 */
export function CollectionInfo({
  summary,
  hasNotice,
  children,
}: {
  summary: string;
  hasNotice: boolean;
  children?: ReactNode;
}) {
  const t = useTranslations("Sbirka");
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-gray-600">
        <span>{summary}</span>
        {hasNotice && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={t("progressToggle")}
            title={t("progressToggle")}
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
      {hasNotice && open && children}
    </div>
  );
}
