import type { Metadata } from "next";
import Link from "next/link";
import { HelpCircle, MapPin } from "lucide-react";
import {
  formatDateTimeCs,
  formatLocationId,
  formatTimeSinceCs,
} from "@/lib/format";
import {
  getCollectionStats,
  type CalendarPoint,
  type FindHighlight,
  type LocationPoint,
  type MonthDayPoint,
} from "@/lib/queries/stats";

export const metadata: Metadata = {
  title: "Statistiky",
  description: "Přehled sbírky čtyřlístků v číslech.",
};

// Matches STATS_REVALIDATE in src/lib/constants.ts (6 hours).
export const revalidate = 21600;

export default async function StatistikyPage() {
  const stats = await getCollectionStats();
  const { totals, firstFind, lastFind, topLocations } = stats;
  const fmt = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 });

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-3xl font-bold text-gray-900">Statistiky</h1>
        <p className="mt-2 text-gray-600">Souhrn sbírky.</p>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TotalCard label="nálezů" value={fmt.format(totals.finds)} />
        <TotalCard label="lokalit" value={fmt.format(totals.locations)} />
      </section>

      {(firstFind || lastFind) && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {firstFind && <FindHighlightCard label="První nález" find={firstFind} />}
          {lastFind && lastFind.id !== firstFind?.id && (
            <FindHighlightCard label="Poslední nález" find={lastFind} />
          )}
        </section>
      )}

      {topLocations.length > 0 && <TopLocationsCard rows={topLocations} />}

      <CalendarStatsSection
        byHour={stats.byHour}
        byDayOfWeek={stats.byDayOfWeek}
        byMonthOfYear={stats.byMonthOfYear}
        byMonthDay={stats.byMonthDay}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Totals + first/last find

function TotalCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
      <p className="text-4xl font-bold text-brand-700">{value}</p>
      <p className="mt-1 text-sm text-gray-500">{label}</p>
    </div>
  );
}

function FindHighlightCard({
  label,
  find,
}: {
  label: string;
  find: FindHighlight;
}) {
  const date = find.foundAt ? new Date(find.foundAt) : null;
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          {label}
        </h2>
        <span className="font-mono text-xs text-gray-500">
          {formatLocationId(find.id)}
        </span>
      </div>

      <p className="mt-2 text-base font-semibold text-gray-900">
        {date ? formatDateTimeCs(date) : "Datum nálezu chybí"}
      </p>
      {date && (
        <p className="text-xs text-gray-500">{formatTimeSinceCs(date)}</p>
      )}

      <div className="mt-3">
        {find.location ? (
          <div>
            <p className="font-mono text-sm text-gray-900">
              {find.location.code}
            </p>
            {find.location.displayName &&
              find.location.displayName !== find.location.code && (
                <p className="text-xs text-gray-500">
                  {find.location.displayName}
                </p>
              )}
          </div>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-sm text-purple-700">
            <HelpCircle className="h-4 w-4" aria-hidden />
            Anonymizovaná lokalita
          </p>
        )}
      </div>

      {/* mt-auto + flex justify-center pushes the link to the bottom and
          centres it horizontally so the two highlight cards line up. */}
      <div className="mt-auto flex justify-center pt-4">
        <Link
          href={`/sbirka/${find.id}`}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          Otevřít nález #{find.id} →
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Top locations

function TopLocationsCard({ rows }: { rows: readonly LocationPoint[] }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          TOP {rows.length} lokalit
        </h2>
        <p className="text-sm text-gray-500">Nejpilnější místa nálezů</p>
      </header>
      <ol className="space-y-2">
        {rows.map((r, i) => (
          <li
            key={r.id}
            className="flex items-center gap-3 rounded-md border border-gray-100 bg-gray-50 p-3"
          >
            <span className="w-6 shrink-0 text-center font-mono text-sm font-semibold text-brand-700">
              {i + 1}.
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-xs text-gray-500">
                  {formatLocationId(r.id)}
                </span>
                <span className="truncate text-sm font-semibold text-gray-900">
                  {r.code}
                </span>
              </div>
              {r.name && r.name !== r.code && (
                <p className="truncate text-xs text-gray-500" title={r.name}>
                  {r.name}
                </p>
              )}
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{
                      width: max > 0 ? `${(r.count / max) * 100}%` : "0%",
                    }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-gray-600">
                  {r.count}
                </span>
              </div>
            </div>
            <Link
              href={`/mapa?focus=${r.id}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Mapa</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
//  Calendar statistics — hour, day of week, month of year

const HOUR_KEYS = Array.from({ length: 24 }, (_, i) => i);
const DOW_KEYS = [1, 2, 3, 4, 5, 6, 7]; // ISO: 1 = Monday
const MONTH_KEYS = Array.from({ length: 12 }, (_, i) => i + 1);

const DOW_LABELS: Record<number, string> = {
  1: "pondělí",
  2: "úterý",
  3: "středa",
  4: "čtvrtek",
  5: "pátek",
  6: "sobota",
  7: "neděle",
};

const DOW_SHORT: Record<number, string> = {
  1: "po",
  2: "út",
  3: "st",
  4: "čt",
  5: "pá",
  6: "so",
  7: "ne",
};

const MONTH_LABELS: Record<number, string> = {
  1: "leden",
  2: "únor",
  3: "březen",
  4: "duben",
  5: "květen",
  6: "červen",
  7: "červenec",
  8: "srpen",
  9: "září",
  10: "říjen",
  11: "listopad",
  12: "prosinec",
};

const MONTH_SHORT: Record<number, string> = {
  1: "led",
  2: "úno",
  3: "bře",
  4: "dub",
  5: "kvě",
  6: "čvn",
  7: "čvc",
  8: "srp",
  9: "zář",
  10: "říj",
  11: "lis",
  12: "pro",
};

function fillSeries(
  data: readonly CalendarPoint[],
  keys: readonly number[],
): CalendarPoint[] {
  const map = new Map<number, number>();
  for (const d of data) map.set(d.key, d.count);
  return keys.map((k) => ({ key: k, count: map.get(k) ?? 0 }));
}

function CalendarStatsSection({
  byHour,
  byDayOfWeek,
  byMonthOfYear,
  byMonthDay,
}: {
  byHour: readonly CalendarPoint[];
  byDayOfWeek: readonly CalendarPoint[];
  byMonthOfYear: readonly CalendarPoint[];
  byMonthDay: readonly MonthDayPoint[];
}) {
  const hourly = fillSeries(byHour, HOUR_KEYS);
  const daily = fillSeries(byDayOfWeek, DOW_KEYS);
  const monthly = fillSeries(byMonthOfYear, MONTH_KEYS);

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-gray-900">
          Kalendářní statistiky
        </h2>
        <p className="text-sm text-gray-500">
          Rozložení nálezů podle hodiny dne, dne v týdnu, měsíce v roce a
          po dnech kalendářního roku.
        </p>
      </header>

      <CalendarSubsection
        title="Podle hodiny dne"
        data={hourly}
        labelLong={(k) => `${String(k).padStart(2, "0")}:00`}
        labelShort={(k) => String(k).padStart(2, "0")}
        tableColumns={2}
      />

      <CalendarSubsection
        title="Podle dne v týdnu"
        data={daily}
        labelLong={(k) => DOW_LABELS[k] ?? String(k)}
        labelShort={(k) => DOW_SHORT[k] ?? String(k)}
        tableColumns={1}
      />

      <CalendarSubsection
        title="Podle měsíce v roce"
        data={monthly}
        labelLong={(k) => MONTH_LABELS[k] ?? String(k)}
        labelShort={(k) => MONTH_SHORT[k] ?? String(k)}
        tableColumns={1}
      />

      <MonthDayHeatmap data={byMonthDay} />
    </section>
  );
}

// Days per month for a leap year so 29. února shows up as a real cell.
const DAYS_PER_MONTH: Record<number, number> = {
  1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30,
  7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31,
};

function MonthDayHeatmap({
  data,
}: {
  data: readonly MonthDayPoint[];
}) {
  // Sparse data → dense lookup keyed "M-D".
  const counts = new Map<string, number>();
  for (const p of data) counts.set(`${p.month}-${p.day}`, p.count);

  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const months = MONTH_KEYS;
  const max = data.reduce((m, p) => Math.max(m, p.count), 0);

  // Per-month and per-day totals (real days only — non-existent cells
  // like 31. února don't contribute).
  const monthTotals = new Map<number, number>();
  const dayTotals = new Map<number, number>();
  let grandTotal = 0;
  for (const m of months) {
    let mt = 0;
    for (const d of days) {
      if (d > (DAYS_PER_MONTH[m] ?? 31)) continue;
      const c = counts.get(`${m}-${d}`) ?? 0;
      mt += c;
      dayTotals.set(d, (dayTotals.get(d) ?? 0) + c);
      grandTotal += c;
    }
    monthTotals.set(m, mt);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Kalendářní heatmapa
      </h3>
      <p className="mb-3 text-xs text-gray-500">
        Počty nálezů podle dne v roce napříč všemi roky. Sytost zelené
        odpovídá podílu vůči maximálnímu dni ({max}).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px] tabular-nums">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white p-1 text-left text-gray-500">
                {/* corner */}
              </th>
              {days.map((d) => (
                <th
                  key={d}
                  className="w-7 p-0.5 text-center font-medium text-gray-500"
                >
                  {d}
                </th>
              ))}
              <th className="w-10 p-0.5 text-center font-semibold text-gray-700">
                Σ
              </th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const monthMax = DAYS_PER_MONTH[m] ?? 31;
              return (
                <tr key={m}>
                  <th className="sticky left-0 z-10 bg-white p-1 pr-2 text-right font-medium text-gray-700">
                    {capitalize(MONTH_SHORT[m] ?? "")}
                  </th>
                  {days.map((d) => {
                    if (d > monthMax) {
                      return (
                        <td
                          key={d}
                          className="w-7 border border-gray-100 text-center text-gray-300"
                          aria-hidden
                        >
                          ×
                        </td>
                      );
                    }
                    const c = counts.get(`${m}-${d}`) ?? 0;
                    const intensity = max > 0 ? c / max : 0;
                    // Lightness drops 0.97 → 0.45 as count grows; chroma
                    // grows so darker cells stay vibrantly green. White
                    // text once lightness goes below ~0.6.
                    const L = 0.97 - intensity * 0.5;
                    const C = 0.04 + intensity * 0.13;
                    const fg = L < 0.6 ? "#ffffff" : "var(--color-gray-900)";
                    return (
                      <td
                        key={d}
                        className="w-7 border border-white text-center"
                        style={{
                          backgroundColor: `oklch(${L} ${C} 145)`,
                          color: fg,
                        }}
                        title={`${d}. ${MONTH_LABELS[m]}: ${c} ${c === 1 ? "nález" : c >= 2 && c <= 4 ? "nálezy" : "nálezů"}`}
                      >
                        {c}
                      </td>
                    );
                  })}
                  <td className="w-10 border border-gray-100 bg-gray-50 text-center font-semibold text-gray-700">
                    {monthTotals.get(m) ?? 0}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th className="sticky left-0 z-10 bg-white p-1 pr-2 text-right font-semibold text-gray-700">
                Σ
              </th>
              {days.map((d) => (
                <td
                  key={d}
                  className="w-7 border border-gray-100 bg-gray-50 text-center font-medium text-gray-700"
                >
                  {dayTotals.get(d) ?? 0}
                </td>
              ))}
              <td className="w-10 border border-gray-100 bg-brand-50 text-center font-bold text-brand-700">
                {grandTotal}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function CalendarSubsection({
  title,
  data,
  labelLong,
  labelShort,
  tableColumns,
}: {
  title: string;
  data: readonly CalendarPoint[];
  labelLong: (k: number) => string;
  labelShort: (k: number) => string;
  tableColumns: 1 | 2;
}) {
  const max = data.reduce((m, d) => Math.max(m, d.count), 0);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h3>

      {/* Vertical column chart */}
      <div className="flex h-32 items-end gap-1">
        {data.map((d) => (
          <div
            key={d.key}
            className="flex flex-1 flex-col items-center justify-end gap-1"
            title={`${labelLong(d.key)}: ${d.count}`}
          >
            <div
              className="w-full rounded-t bg-brand-500"
              style={{
                height: max > 0 ? `${(d.count / max) * 100}%` : "0%",
                minHeight: d.count > 0 ? "2px" : "0",
              }}
            />
          </div>
        ))}
      </div>
      {/* X-axis labels — outside the flex height so empty bars don't push them around */}
      <div className="mt-1 flex gap-1">
        {data.map((d) => (
          <span
            key={d.key}
            className="flex-1 truncate text-center font-mono text-[10px] text-gray-500"
          >
            {labelShort(d.key)}
          </span>
        ))}
      </div>

      {/* Numeric table */}
      <dl
        className={`mt-4 grid gap-x-6 gap-y-1 text-sm ${
          tableColumns === 2 ? "grid-cols-2" : "grid-cols-1"
        }`}
      >
        {data.map((d) => (
          <div
            key={d.key}
            className="flex items-baseline justify-between border-b border-gray-100 py-1"
          >
            <dt className="text-gray-700">{labelLong(d.key)}</dt>
            <dd className="font-mono tabular-nums text-gray-900">
              {d.count}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
