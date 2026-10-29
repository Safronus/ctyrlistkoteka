"use client";

import { useTranslations } from "next-intl";
import { HelpCircle } from "lucide-react";
import type { HuntGame } from "./hunt";

/**
 * One-line goal above the field plus a collapsed „Jak hrát?“ with the
 * rules: controls for this game (mouse, finger, keyboard), decoys, how the
 * rounds get harder and that they go on past round 8 as „8+“, the clock,
 * and where the records live. Collapsed by default and not remembered —
 * no extra browser storage beyond the approved records (CLAUDE.md §3).
 */
export function HowToPlay({ game }: { game: HuntGame }) {
  const t = useTranslations("NotFound");
  const meadow = game === "meadow";
  const rules = [
    t("howToGoal"),
    meadow ? t("howToControlsMeadow") : t("howToControlsLens"),
    t("howToDecoy"),
    meadow ? t("howToRoundsMeadow") : t("howToRoundsLens"),
    t("howToEndless"),
    t("howToClock"),
    t("howToStored"),
  ];

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-2 text-center">
      <p className="text-sm text-gray-700 sm:text-base">{meadow ? t("meadowHint") : t("lensHint")}</p>
      <details className="w-full rounded-lg border border-brand-200 bg-white/70 px-3 py-2 text-left text-sm">
        {/* Stays display:list-item so the ▸ marker shows, like the speed table. */}
        <summary className="cursor-pointer font-medium text-brand-800">
          <HelpCircle className="mr-1.5 inline h-4 w-4 align-[-3px]" aria-hidden />
          {t("howToTitle")}
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-700">
          {rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
