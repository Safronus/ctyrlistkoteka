"use client";

import { Shuffle } from "lucide-react";
import { useTranslations } from "next-intl";
import { CLOVER_FACT_ADVANCE_EVENT } from "@/components/home/clover-fact-card";

/**
 * Highlights-row tile that surfaces the size of the rotating clover-fact
 * collection living in the hero card. Visitors typically only see one or
 * two entries before leaving — this tile reveals there's a richer set
 * underneath (incl. the author's bonus entries) and gives a button that
 * forces the hero rotator to advance to a new random text in place.
 */
export function CloverFactsStatCard({
  total,
  bonus,
  categories,
}: {
  total: number;
  bonus: number;
  categories: number;
}) {
  const t = useTranslations("CloverFacts");

  const advance = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(CLOVER_FACT_ADVANCE_EVENT));
  };

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {t("tileLabel")}
      </p>
      <p className="mt-1 truncate text-base font-semibold text-gray-900">
        {t("tileTotal", { count: total })}
      </p>
      {bonus > 0 && (
        <p className="mt-0.5 text-xs text-gray-500">
          {t("tileBonusHint", { count: bonus })}
        </p>
      )}
      <div className="flex flex-1 flex-col items-center justify-center gap-1 py-1.5 text-center">
        {categories > 0 && (
          <p className="text-xs text-gray-500">
            {t("tileCategoryCount", { count: categories })}
          </p>
        )}
      </div>
      <div className="mt-auto pt-2">
        <button
          type="button"
          onClick={advance}
          aria-label={t("tileNextAria")}
          title={t("tileNextTitle")}
          className="flex w-full items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm focus:border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <Shuffle className="h-3.5 w-3.5" aria-hidden />
          <span>{t("tileNextLabel")}</span>
        </button>
      </div>
    </div>
  );
}
