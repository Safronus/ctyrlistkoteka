import type { ReactNode } from "react";

/**
 * The "Filtr je aktivní — N … (popis)" strip shown below the filters on
 * both /sbirka and /lokality. Server component — the pages compose the
 * localized `label` / `matches` strings and the human `summary` (via
 * buildFilterSummary) and pass them in, so this stays a dumb presenter and
 * the two pages read identically.
 *
 * `action` is an optional right-aligned slot — /sbirka drops its "Zobrazit
 * na mapě" chip there; /lokality leaves it empty.
 */
export function FilterActiveNotice({
  label,
  matches,
  summary,
  action,
}: {
  /** e.g. "Filtr je aktivní —" */
  label: string;
  /** e.g. "876 🍀 odpovídá filtru" (already includes the count). */
  matches: string;
  /** Human filter description in parentheses, e.g. "stav Darovaný, rok
   *  2024". Empty → no parenthetical. */
  summary?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-sm text-brand-900">
      <span>
        {label}{" "}
        <strong className="font-semibold">{matches}</strong>
        {summary && (
          <span className="font-normal text-brand-800/80"> ({summary})</span>
        )}
      </span>
      {action}
    </div>
  );
}
