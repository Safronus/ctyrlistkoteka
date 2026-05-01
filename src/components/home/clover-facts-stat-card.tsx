"use client";

import { Shuffle } from "lucide-react";
import { pluralCs } from "@/lib/format";
import { CLOVER_FACT_ADVANCE_EVENT } from "@/components/home/clover-fact-card";

const NF_CS = new Intl.NumberFormat("cs-CZ");

const CURIOSITIES = ["zajímavost", "zajímavosti", "zajímavostí"] as const;
const BONUSES = ["bonus", "bonusy", "bonusů"] as const;
const CATEGORIES = ["kategorie", "kategorie", "kategorií"] as const;

/**
 * Highlights-row tile that surfaces the size of the rotating clover-fact
 * collection living in the hero card. Visitors typically only see one or
 * two entries before leaving — this tile reveals there's a richer set
 * underneath (incl. the author's bonus entries) and gives a button that
 * forces the hero rotator to advance to a new random text in place.
 *
 * The advance is wired through a window CustomEvent rather than lifted
 * state because the hero card and this tile sit in different SSR-rooted
 * subtrees of the home page; sharing through context would force the
 * whole page to bend around a client boundary just for one click. The
 * event name is exported from `clover-fact-card.tsx` so the two stay
 * agreed on the wire literal.
 */
export function CloverFactsStatCard({
  total,
  bonus,
  categories,
  categoryLabels,
}: {
  total: number;
  bonus: number;
  categories: number;
  /** Sorted Czech labels for every distinct category present in the
   *  rotator dataset — rendered as a wrapping comma-list under the hint
   *  so the visitor sees what kinds of curiosities the rotator covers
   *  without having to wait through ~10 rotations. */
  categoryLabels: readonly string[];
}) {
  const advance = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(CLOVER_FACT_ADVANCE_EVENT));
  };

  // Hint reads as a comma-list when there's authored content to call
  // out, otherwise just the category count. Author bonuses get the
  // emerald BONUS treatment in the rotator card itself, so naming them
  // here doubles as a hint that the hero card has a richer mode.
  const hintParts: string[] = [];
  if (bonus > 0) {
    hintParts.push(
      `z toho ${NF_CS.format(bonus)} ${pluralCs(bonus, BONUSES)} autora`,
    );
  }
  if (categories > 0) {
    hintParts.push(
      `${NF_CS.format(categories)} ${pluralCs(categories, CATEGORIES)}`,
    );
  }

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Zajímavosti o čtyřlístcích
      </p>
      <p className="mt-1 truncate text-base font-semibold text-gray-900">
        {NF_CS.format(total)} {pluralCs(total, CURIOSITIES)}
      </p>
      {hintParts.length > 0 && (
        <p className="mt-0.5 text-xs text-gray-500">
          {hintParts.join(" · ")}
        </p>
      )}
      {categoryLabels.length > 0 && (
        // Smaller font + lighter colour than the hint so the list reads
        // as supporting context rather than a second headline. `leading-snug`
        // keeps the wrapped lines visually tight when the chip-row would
        // otherwise add too much vertical drift to the tile.
        <p className="mt-1 text-[11px] leading-snug text-gray-400">
          {categoryLabels.join(" · ")}
        </p>
      )}
      <div className="mt-auto pt-2">
        <button
          type="button"
          onClick={advance}
          aria-label="Zobrazit jinou zajímavost v lístku vedle hrdiny"
          title="Zobrazí jinou zajímavost v lístku vedle hrdiny"
          className="flex w-full items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm focus:border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <Shuffle className="h-3.5 w-3.5" aria-hidden />
          <span>Další zajímavost</span>
        </button>
      </div>
    </div>
  );
}
