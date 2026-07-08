"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Info, X } from "lucide-react";
import { cloverCategoryKey } from "@/lib/cloverFactsLabels";

/**
 * Small ⓘ affordance pinned to the hero clover-fact card's top-right corner.
 * Click opens a popover describing the rotating fact collection: its size
 * (total + author bonus) and the breadth of topics (localized category
 * chips) — the same info the old "Zajímavosti o čtyřlístcích" highlights
 * tile carried, minus its shuffle button (the card already has its own).
 * Closes on Escape or an outside click.
 */
export function CloverFactsInfoButton({
  total,
  bonus,
  categoryKeys,
}: {
  total: number;
  bonus: number;
  /** Raw category strings as they live in clover-texts.json; localized here
   *  via `cloverCategoryKey` + the CloverFacts namespace. */
  categoryKeys: readonly string[];
}) {
  const t = useTranslations("CloverFacts");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const categoryLabels = categoryKeys
    .map((c) => {
      const k = cloverCategoryKey(c);
      return k ? t(k) : c;
    })
    .sort((a, b) => a.localeCompare(b));

  return (
    <div
      ref={ref}
      // On the card's top edge, just LEFT of the thumbtack pin (which sits
      // at right-6) so the ⓘ reads as part of the pin cluster rather than
      // hanging off the right corner. Desktop keeps its roomier placement
      // hanging fully to the right of the card.
      className="absolute -top-3 right-12 z-20 lg:left-full lg:right-auto lg:top-1 lg:ml-2"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("infoAria")}
        title={t("infoAria")}
        className="inline-flex h-7 w-7 items-center justify-center rounded text-gray-500 transition hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <Info className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("infoAria")}
          className="absolute right-0 top-9 z-30 w-64 max-w-[80vw] rounded-lg border border-gray-200 bg-white p-3 text-left shadow-xl"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-brand-700">
              {t("tileLabel")}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("infoClose")}
              className="-mr-1 -mt-1 rounded p-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <p className="mt-0.5 text-sm font-semibold text-gray-900">
            {t("tileTotal", { count: total })}
          </p>
          {bonus > 0 && (
            <p className="text-xs text-gray-500">
              {t("tileBonusHint", { count: bonus })}
            </p>
          )}
          {categoryLabels.length > 0 && (
            <>
              <p className="mt-2 text-[10px] uppercase tracking-wide text-gray-600">
                {t("tileCategoryCount", { count: categoryLabels.length })}
              </p>
              <ul className="mt-1 flex flex-wrap gap-1">
                {categoryLabels.map((name) => (
                  <li
                    key={name}
                    className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700"
                  >
                    {name}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
