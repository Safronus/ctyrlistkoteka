"use client";

import { useState } from "react";
import type { YearlyPaceEntry } from "@/lib/queries/stats";
import { formatLongDuration, pluralCs } from "@/lib/format";

const fmtPace = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 });
const fmtCount = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 });

export function YearlyPaceBlock({ entries }: { entries: readonly YearlyPaceEntry[] }) {
  // Default to the latest year — most users care about "what's my
  // pace right now" first; older years are one click away. The
  // server already sorts entries ascending so the last one is latest.
  const initialYear = entries[entries.length - 1]?.year;
  const [selectedYear, setSelectedYear] = useState<number | undefined>(initialYear);

  if (entries.length === 0 || initialYear === undefined) return null;

  const selected = entries.find((e) => e.year === selectedYear) ?? entries[entries.length - 1]!;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-baseline justify-center gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Průměrné tempo v roce
        </p>
        {/* Inline segmented selector — for the typical 4–6 year span
            it's nicer than a `<select>`. Wraps on narrow viewports. */}
        <div
          role="group"
          aria-label="Rok"
          className="inline-flex flex-wrap overflow-hidden rounded-md border border-gray-300 bg-white"
        >
          {entries.map((e, i) => {
            const active = e.year === selected.year;
            return (
              <button
                key={e.year}
                type="button"
                onClick={() => setSelectedYear(e.year)}
                aria-pressed={active}
                className={`px-2.5 py-1 text-xs font-medium tabular-nums transition ${
                  i > 0 ? "border-l border-gray-300" : ""
                } ${
                  active
                    ? "bg-brand-600 text-white"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {e.year}
              </button>
            );
          })}
        </div>
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <PaceCell label="/ hodinu" value={fmtPace.format(selected.perHour)} />
        <PaceCell label="/ den" value={fmtPace.format(selected.perDay)} />
        <PaceCell label="/ týden" value={fmtPace.format(selected.perWeek)} />
        <PaceCell label="/ měsíc" value={fmtPace.format(selected.perMonth)} />
        <PaceCell label="/ rok" value={fmtPace.format(selected.perYear)} />
      </ul>
      {/* Year-scoped meta: same `·`-separated micro-list as elsewhere on
          the page so the visual rhythm matches the other captions.
          Wraps cleanly on mobile thanks to inline-block / flex-wrap. */}
      <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-gray-500">
        <span>
          {fmtCount.format(selected.totalFinds)}{" "}
          {pluralCs(selected.totalFinds, ["nález", "nálezy", "nálezů"])} v
          roce {selected.year}
        </span>
        <span aria-hidden className="text-gray-300">
          ·
        </span>
        <span title="Odhadovaná doba sbírání v tomto roce — součet hledání + 2 min baseline / hledání.">
          {formatLongDuration(selected.estimatedMinutes)} sbírání
        </span>
        <span aria-hidden className="text-gray-300">
          ·
        </span>
        <span>
          {fmtCount.format(selected.sessions)}{" "}
          {pluralCs(selected.sessions, ["hledání", "hledání", "hledání"])}
        </span>
        <span aria-hidden className="text-gray-300">
          ·
        </span>
        <span>
          {fmtCount.format(selected.locationCount)}{" "}
          {pluralCs(selected.locationCount, [
            "lokalita",
            "lokality",
            "lokalit",
          ])}
        </span>
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
