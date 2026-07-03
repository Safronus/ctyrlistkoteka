"use client";

import { Shuffle } from "lucide-react";
import { useTranslations } from "next-intl";
import { CLOVER_FACT_ADVANCE_EVENT } from "@/components/home/clover-fact-card";
import { cloverCategoryKey } from "@/lib/cloverFactsLabels";

/**
 * Highlights-row tile that surfaces the size of the rotating clover-fact
 * collection living in the hero card. Visitors typically only see one or
 * two entries before leaving — this tile reveals there's a richer set
 * underneath (incl. the author's bonus entries) plus the breadth of
 * topics, and gives a button that forces the hero rotator to advance
 * to a new random text in place.
 */
export function CloverFactsStatCard({
  total,
  bonus,
  categoryKeys,
}: {
  total: number;
  bonus: number;
  /** Raw category strings as they live in clover-texts.json (e.g.
   *  "botany", "history"). The component runs them through
   *  `cloverCategoryKey` to localize via the CloverFacts namespace. */
  categoryKeys: readonly string[];
}) {
  const t = useTranslations("CloverFacts");

  const advance = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(CLOVER_FACT_ADVANCE_EVENT));
    // The tile lives in the highlights row below the fold — after firing
    // the rotation, bring the (now-changed) hero card back into view and
    // move focus to it so the visitor actually sees the new lísteček
    // (and screen-reader users land on the fresh content).
    const card = document.getElementById("clover-fact-card");
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.focus({ preventScroll: true });
    }
  };

  // Map raw category strings to localized labels, sort alphabetically
  // by display name so the chips read predictably. Unknown keys fall
  // through verbatim (matches the rotator's fallback rule — see the
  // comment in cloverFactsLabels.ts).
  const categoryLabels = categoryKeys
    .map((c) => {
      const k = cloverCategoryKey(c);
      return k ? t(k) : c;
    })
    .sort((a, b) => a.localeCompare(b));

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-3 text-center">
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
      <div className="flex flex-1 flex-col justify-center gap-1 py-1.5">
        {categoryLabels.length > 0 && (
          <>
            <p className="text-[10px] uppercase tracking-wide text-gray-600">
              {t("tileCategoryCount", { count: categoryLabels.length })}
            </p>
            <ul className="flex flex-wrap justify-center gap-1">
              {categoryLabels.map((name) => (
                <li
                  key={name}
                  className="rounded-full bg-gray-100 px-1.5 py-0.5 font-medium text-[10px] text-gray-700"
                >
                  {name}
                </li>
              ))}
            </ul>
          </>
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
