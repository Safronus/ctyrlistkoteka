"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Info } from "lucide-react";

/**
 * Collection freshness line under the hero intro. Shows a single compact
 * "last updated (+N)" line; a small ⓘ toggle reveals the founding date and
 * the last historic-backfill upload — kept out of the way but still on the
 * page. Dates arrive pre-formatted from the server (formatShortDateTimeCs is
 * not timezone-pinned, so formatting client-side would risk a hydration
 * mismatch); the pluralised counts are formatted here via next-intl.
 */
export function CollectionFreshnessNote({
  lastUpdated,
  latestCount,
  firstFound,
  lastBackfill,
  backfillCount,
}: {
  lastUpdated: string | null;
  latestCount: number;
  firstFound: string | null;
  lastBackfill: string | null;
  backfillCount: number;
}) {
  const t = useTranslations("Home");
  const [open, setOpen] = useState(false);

  // Primary line is the freshness ("last updated"); if there's somehow no
  // upload timestamp, fall back to the founding date so the note still says
  // something. Details behind the toggle: founding + last backfill.
  const primaryLabel = lastUpdated ? t("lastUpdated") : t("firstFound");
  const primaryValue = lastUpdated ?? firstFound;
  if (!primaryValue) return null;

  const showFirstInDetails = Boolean(lastUpdated && firstFound);
  const hasDetails = showFirstInDetails || Boolean(lastBackfill);

  return (
    <div className="mt-2 text-center text-xs text-gray-600">
      <p className="inline-flex flex-wrap items-center justify-center gap-1">
        <span>
          {primaryLabel}{" "}
          <span className="text-gray-500">{primaryValue}</span>
          {lastUpdated && latestCount > 0 && (
            <span className="text-gray-500">
              {" "}
              ({t("lastBackfillCount", { count: latestCount })})
            </span>
          )}
        </span>
        {hasDetails && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={t("collectionDetailsToggle")}
            title={t("collectionDetailsToggle")}
            className="inline-flex items-center rounded-full p-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </p>
      {open && hasDetails && (
        <div className="mt-1 space-y-0.5 text-gray-500">
          {showFirstInDetails && firstFound && (
            <p>
              {t("firstFound")}{" "}
              <span className="text-gray-500">{firstFound}</span>
            </p>
          )}
          {lastBackfill && (
            <p>
              {t("lastBackfill")}{" "}
              <span className="text-gray-500">{lastBackfill}</span>
              {backfillCount > 0 && (
                <> ({t("lastBackfillCount", { count: backfillCount })})</>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
