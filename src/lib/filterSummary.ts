import type { FindFilters } from "@/lib/queries/finds";

type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export interface FilterSummaryResolvers {
  /** Translator bound to the "FilterSummary" namespace. */
  t: Translate;
  /** Translator bound to the "States" namespace (state label). */
  stateLabel: (state: string) => string;
  locationLabel: (id: number) => string;
  countryLabel: (code: string) => string;
  cityLabel: (name: string) => string;
  formatDay: (d: Date) => string;
  formatInstant: (d: Date) => string;
}

/**
 * Human-readable, one-line summary of the active find filters, e.g.
 * "stav Darovaný, rok 2024" or "sběr 12. 5. 2026 8:50 – 11:20". Returns
 * an empty string when nothing is active.
 *
 * Shared by /sbirka (the "Filtr je aktivní — N 🍀 …" banner) and /mapa
 * (the location detail sheet's filter-context line) so both describe a
 * deep-link the same way — the visitor always sees WHY the view is
 * narrowed, which matters most when they arrive from a source that set a
 * non-obvious filter (e.g. the homepage "Nejlepší den" date link).
 */
export function buildFilterSummary(
  f: FindFilters,
  r: FilterSummaryResolvers,
): string {
  const parts: string[] = [];
  if (f.q?.trim()) parts.push(r.t("search", { q: f.q.trim() }));
  if (f.locationId != null) {
    parts.push(r.t("location", { label: r.locationLabel(f.locationId) }));
  }
  if (f.cadastralArea) {
    parts.push(r.t("city", { name: r.cityLabel(f.cadastralArea) }));
  }
  if (f.country) parts.push(r.t("country", { name: r.countryLabel(f.country) }));
  if (f.state) parts.push(r.t("state", { label: r.stateLabel(f.state) }));
  if (f.year != null) parts.push(r.t("year", { year: f.year }));
  // Instant window (a /statistiky "zátah" deep-link) takes precedence over
  // the day-level range — they never both apply from a real source, but if
  // they did the precise one is the more informative label.
  if (f.foundAtFrom || f.foundAtTo) {
    parts.push(
      r.t("session", {
        from: f.foundAtFrom ? r.formatInstant(f.foundAtFrom) : "…",
        to: f.foundAtTo ? r.formatInstant(f.foundAtTo) : "…",
      }),
    );
  } else if (f.dateFrom || f.dateTo) {
    const from = f.dateFrom ? r.formatDay(f.dateFrom) : null;
    const to = f.dateTo ? r.formatDay(f.dateTo) : null;
    if (from && to && from === to) parts.push(r.t("day", { date: from }));
    else parts.push(r.t("dayRange", { from: from ?? "…", to: to ?? "…" }));
  }
  if (f.hasRealPhoto) parts.push(r.t("hasPhoto"));
  if (f.excludeLocationId != null) parts.push(r.t("hideTop"));
  return parts.join(", ");
}
