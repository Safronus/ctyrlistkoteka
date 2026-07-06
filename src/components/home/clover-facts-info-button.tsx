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
      // Sits just OUTSIDE the card's top-right corner (never over the card
      // content — the corners already hold the category / source pills).
      // Desktop has room to the right so it hangs fully to the right of the
      // corner; on mobile the card is near full width, so it straddles the
      // corner (centered on the right edge, lifted above the top edge) —
      // which keeps it clear of the pills AND inside the viewport (no
      // horizontal overflow).
      className="absolute -top-3 right-0 z-20 translate-x-1/2 lg:left-full lg:right-auto lg:top-1 lg:ml-2 lg:translate-x-0"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("infoAria")}
        title={t("infoAria")}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/80 text-gray-500 shadow-sm ring-1 ring-black/5 backdrop-blur transition hover:bg-white hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
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
            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
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
