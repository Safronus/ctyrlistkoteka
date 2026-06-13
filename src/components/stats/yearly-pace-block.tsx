"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Info } from "lucide-react";
import type { YearlyPaceEntry } from "@/lib/queries/stats";
import { formatLongDuration } from "@/lib/format";

function toIntlLocale(locale: string): string {
  if (locale === "cs") return "cs-CZ";
  if (locale === "en") return "en-GB";
  return locale;
}

export function YearlyPaceBlock({
  entries,
}: {
  entries: readonly YearlyPaceEntry[];
}) {
  const t = useTranslations("Statistiky");
  const locale = useLocale();
  const intlLocale = toIntlLocale(locale);
  const fmtPace = new Intl.NumberFormat(intlLocale, {
    maximumFractionDigits: 1,
  });

  const initialYear = entries[entries.length - 1]?.year;
  const [selectedYear, setSelectedYear] = useState<number | undefined>(
    initialYear,
  );

  if (entries.length === 0 || initialYear === undefined) return null;

  const selected =
    entries.find((e) => e.year === selectedYear) ??
    entries[entries.length - 1]!;

  // Both edge years are partial: the first only started once the very
  // first find was made (mid-year), and the last runs only up to the
  // most recent find (and is usually the ongoing current year). Their
  // per-year extrapolations therefore read low vs. a full year, so we
  // flag them on the chips + with a contextual note.
  const firstYear = entries[0]!.year;
  const lastYear = entries[entries.length - 1]!.year;
  const isIncomplete = (y: number) => y === firstYear || y === lastYear;
  const incompleteKind =
    selected.year === firstYear && selected.year === lastYear
      ? "only"
      : selected.year === firstYear
        ? "first"
        : selected.year === lastYear
          ? "last"
          : null;
  const incompleteNote =
    incompleteKind === "only"
      ? t("paceYearIncompleteOnly")
      : incompleteKind === "first"
        ? t("paceYearIncompleteFirst")
        : incompleteKind === "last"
          ? t("paceYearIncompleteLast")
          : null;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-baseline justify-center gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {t("paceYear")}
        </p>
        {/* Per-button chips with their own border keep the row tidy when
         *  the years wrap on mobile — the old "segmented" approach with
         *  border-l between siblings left an orphan year on its own row
         *  with a stray left-border. */}
        <div
          role="group"
          aria-label={t("yearAria")}
          className="flex flex-wrap items-center justify-center gap-1"
        >
          {entries.map((e) => {
            const active = e.year === selected.year;
            const incomplete = isIncomplete(e.year);
            return (
              <button
                key={e.year}
                type="button"
                onClick={() => setSelectedYear(e.year)}
                aria-pressed={active}
                title={incomplete ? t("paceYearIncompleteMark") : undefined}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium tabular-nums transition ${
                  active
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {e.year}
                {incomplete && (
                  <span
                    aria-hidden
                    className={`ml-0.5 align-super text-[8px] ${
                      active ? "text-amber-200" : "text-amber-600"
                    }`}
                  >
                    *
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <PaceCell label={t("perHour")} value={fmtPace.format(selected.perHour)} />
        <PaceCell label={t("perDay")} value={fmtPace.format(selected.perDay)} />
        <PaceCell label={t("perWeek")} value={fmtPace.format(selected.perWeek)} />
        <PaceCell label={t("perMonth")} value={fmtPace.format(selected.perMonth)} />
        <PaceCell label={t("perYearLabel")} value={fmtPace.format(selected.perYear)} />
      </ul>

      {incompleteNote && (
        <p className="mt-2 flex items-center justify-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-center text-[11px] text-amber-800">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{incompleteNote}</span>
        </p>
      )}
      <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-gray-500">
        <span>
          {t("yearFindsCount", {
            count: selected.totalFinds,
            year: selected.year,
          })}
        </span>
        <span aria-hidden className="text-gray-300">
          ·
        </span>
        <span title={t("yearTimeSpentTitle")}>
          {t("yearTimeSpent", {
            duration: formatLongDuration(selected.estimatedMinutes, locale),
          })}
        </span>
        <span aria-hidden className="text-gray-300">
          ·
        </span>
        <span>{t("yearSessions", { count: selected.sessions })}</span>
        <span aria-hidden className="text-gray-300">
          ·
        </span>
        <span>{t("yearLocations", { count: selected.locationCount })}</span>
        {selected.findsPerSession > 0 && (
          <>
            <span aria-hidden className="text-gray-300">
              ·
            </span>
            <span title={t("yearAvgPerSessionTitle")}>
              {t("yearAvgPerSession", {
                avg: fmtPace.format(selected.findsPerSession),
              })}
            </span>
          </>
        )}
      </p>
    </div>
  );
}

function PaceCell({ label, value }: { label: string; value: string }) {
  return (
    <li className="rounded-md border border-gray-200 bg-gray-50 p-2 text-center">
      <p className="font-mono text-sm font-semibold tabular-nums text-gray-900">
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-gray-500">{label}</p>
    </li>
  );
}
