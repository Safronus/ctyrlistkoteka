import type {
  RetrospectiveBundle,
  RetrospectivePeriod,
  RetrospectivePoint,
} from "@/lib/queries/retrospective";
import { FINDS, pluralCs } from "@/lib/format";

const NF_CS = new Intl.NumberFormat("cs-CZ");

/**
 * "Retrospektiva" — 2×2 grid of horizontal mini bar charts comparing
 * the current calendar position (today / ISO week / month / year)
 * across all years the collection has been active. Each panel uses
 * pure HTML + Tailwind (no Recharts) — the per-row layout is a 3-column
 * grid (year label · bar track · count) so all four panels share an
 * identical rhythm without measuring container widths client-side.
 *
 * Bars are sized by `max` within their own panel so a quiet
 * "Den" panel (5 finds total) and a busy "Rok" panel (3000+ finds) both
 * use full bar width for their own peak — comparing across panels
 * isn't the point, comparing years within a panel is.
 *
 * Server-renderable: the home page revalidates hourly + on sync, and
 * the chart has no interactivity beyond hover tooltips (which the
 * `<title>` element handles natively). Server-rendering means no
 * client JS bundle, no SSR fallback, and the page stays sub-second.
 */
export function RetrospectiveGrid({ data }: { data: RetrospectiveBundle }) {
  return (
    <section className="mt-8" aria-labelledby="retro-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="retro-heading"
          className="text-xs font-semibold uppercase tracking-wide text-gray-500"
        >
          Retrospektiva — kde dnes stojím napříč roky
        </h2>
        <p className="text-xs text-gray-400">
          {/* Anchor caption — spells out which "today" is being
              compared so the chart titles read consistently in
              isolation when shared as a screenshot. */}
          {data.today.day}. {data.today.month}. {data.today.year}
          {" · "}ISO týden {data.today.isoWeek}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <RetrospectivePanel period={data.day} />
        <RetrospectivePanel period={data.week} />
        <RetrospectivePanel period={data.month} />
        <RetrospectivePanel period={data.year} />
      </div>
    </section>
  );
}

function RetrospectivePanel({ period }: { period: RetrospectivePeriod }) {
  // `max` over the panel's own points — see file-level note. Floor at
  // 1 so a panel where every year is 0 still renders empty tracks
  // instead of dividing by zero.
  const max = Math.max(1, ...period.points.map((p) => p.count));
  const total = period.points.reduce((sum, p) => sum + p.count, 0);
  return (
    <article className="flex flex-col rounded-xl border border-gray-200 bg-white p-3">
      <header>
        <p className="text-base font-semibold text-gray-900">{period.label}</p>
        <p className="mt-0.5 text-xs text-gray-500">{period.hint}</p>
      </header>
      {/* Bars — fixed-grid columns keep year labels and counts perfectly
          aligned across all four panels, regardless of how many digits
          live in each cell. */}
      <ul className="mt-3 space-y-1">
        {period.points.map((p) => (
          <RetrospectiveRow key={p.year} point={p} max={max} />
        ))}
      </ul>
      {/* Footer total — running across-years sum so the panel's
          headline ("kolik za den 3.5. dohromady") is one glance away. */}
      <p className="mt-2 border-t border-gray-100 pt-2 text-right text-[11px] text-gray-500">
        Celkem za toto období:{" "}
        <span className="font-semibold tabular-nums text-gray-700">
          {NF_CS.format(total)}
        </span>{" "}
        {pluralCs(total, FINDS)}
      </p>
    </article>
  );
}

function RetrospectiveRow({
  point,
  max,
}: {
  point: RetrospectivePoint;
  max: number;
}) {
  // Cap at 100% just in case `max` somehow undershoots (defensive —
  // shouldn't trigger given the Math.max above).
  const pct = Math.min(100, (point.count / max) * 100);
  // Tiny visual indicator for non-zero years that would otherwise
  // disappear at < 1% — keeps the bar discoverable as a hit target
  // for hover/title.
  const widthCss = point.count === 0 ? "0%" : `${Math.max(pct, 2)}%`;
  const yearClasses = point.isCurrent
    ? "font-bold text-brand-700"
    : "text-gray-600";
  const barClasses = point.isCurrent ? "bg-brand-600" : "bg-brand-400";
  const countClasses = point.isCurrent
    ? "font-semibold text-brand-700"
    : "text-gray-700";
  return (
    <li
      className="grid grid-cols-[2.75rem_1fr_3rem] items-center gap-2 text-xs"
      title={`${point.year}: ${NF_CS.format(point.count)} ${pluralCs(point.count, FINDS)}`}
    >
      <span className={`tabular-nums ${yearClasses}`}>{point.year}</span>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full transition-all ${barClasses}`}
          style={{ width: widthCss }}
          aria-hidden
        />
      </div>
      <span className={`text-right font-mono tabular-nums ${countClasses}`}>
        {NF_CS.format(point.count)}
      </span>
    </li>
  );
}
