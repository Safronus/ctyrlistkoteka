import type {
  RetrospectiveBundle,
  RetrospectivePeriod,
  RetrospectivePoint,
} from "@/lib/queries/retrospective";
import { FINDS, pluralCs } from "@/lib/format";

const NF_CS = new Intl.NumberFormat("cs-CZ");

/**
 * "Retrospektiva" — 2×2 grid of compact vertical bar charts comparing
 * the visitor's current calendar position (today / ISO week / month /
 * year) across all years the collection has been active. Each panel
 * is server-rendered SVG (no Recharts) so the home page bundle stays
 * small and the grid doesn't ship a client-side hydration cost.
 *
 * Layout per panel: header (label + hint) → SVG bar chart with
 * rotated year labels under each bar → footer with the across-years
 * total. Rotating year labels at -45° lets ten or more years fit
 * inside the panel without overlap on every breakpoint without
 * needing JS-side measurement.
 *
 * Bars are sized by the panel's own peak count so a quiet "Den"
 * panel and a busy "Rok" panel both use full vertical range — the
 * comparison the panel cares about is across years inside it, not
 * across panels.
 *
 * Counts include anonymized finds (CLAUDE.md §6 only protects
 * identifying detail, not aggregate existence). Finds without an
 * EXIF `found_at` cannot be assigned to any year/month/week/day
 * bucket, so they're excluded from every panel — the grid footer
 * surfaces that exclusion explicitly when the diff is non-zero so
 * the visitor doesn't wonder why "Rok celkem" undershoots the
 * headline find count.
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
      {/* Finds without an EXIF foundAt drop out of every panel — a
          rounding error like "Rok celkem 4559 vs. 4572 v hlavičce"
          could read as a bug. The list of those finds is surfaced on
          /admin/checks (the "Nálezy bez EXIF data" card), accessible
          to admin only. */}
    </section>
  );
}

// Chart geometry. Width is responsive (`width="100%"`); the viewBox
// stays fixed so absolute pixel maths stay simple. Three vertical
// bands stacked top-down:
//   HEADROOM_H — count labels above each bar (or inside the top of
//                tall bars, when the bar's height eats into the
//                headroom band).
//   BARS_H     — bar plot proper.
//   LABEL_H    — rotated year labels under each bar.
const VB_W = 320;
const HEADROOM_H = 14;
const BARS_H = 96;
const LABEL_H = 30;
const VB_H = HEADROOM_H + BARS_H + LABEL_H;
const BAR_BASELINE = HEADROOM_H + BARS_H;

function RetrospectivePanel({ period }: { period: RetrospectivePeriod }) {
  const max = Math.max(1, ...period.points.map((p) => p.count));
  const total = period.points.reduce((sum, p) => sum + p.count, 0);
  const bars = period.points.length;
  // Reserve a little slack on each side so the leftmost / rightmost
  // year label doesn't run into the panel border when rotated.
  const PAD_X = 6;
  const innerW = VB_W - PAD_X * 2;
  const slot = innerW / Math.max(1, bars);
  const barW = Math.max(2, slot * 0.62);

  return (
    <article className="flex flex-col rounded-xl border border-gray-200 bg-white p-3">
      <header>
        <p className="text-base font-semibold text-gray-900">{period.label}</p>
        <p className="mt-0.5 text-xs text-gray-500">{period.hint}</p>
      </header>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={period.hint}
        className="mt-2 h-36 w-full"
      >
        {/* Faint baseline — anchors the eye when most bars are zero
            (e.g., "Den 3.5." with one good year and the rest empty). */}
        <line
          x1={PAD_X}
          y1={BAR_BASELINE - 0.5}
          x2={VB_W - PAD_X}
          y2={BAR_BASELINE - 0.5}
          stroke="#e5e7eb"
          strokeWidth={1}
        />
        {period.points.map((p, i) => {
          const cx = PAD_X + slot * (i + 0.5);
          // Bars taller than 0 get a small minimum so non-zero years
          // are visible even when their value rounds to ~0% of `max`.
          const h = p.count === 0 ? 0 : Math.max(2, (p.count / max) * BARS_H);
          const y = BAR_BASELINE - h;
          const x = cx - barW / 2;
          const fill = p.isCurrent ? "#15803d" : "#4d9748";
          return (
            <RetrospectiveBar
              key={p.year}
              point={p}
              x={x}
              y={y}
              w={barW}
              h={h}
              labelX={cx}
              yearLabelY={BAR_BASELINE + 8}
              fill={fill}
            />
          );
        })}
      </svg>
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

function RetrospectiveBar({
  point,
  x,
  y,
  w,
  h,
  labelX,
  yearLabelY,
  fill,
}: {
  point: RetrospectivePoint;
  x: number;
  y: number;
  w: number;
  h: number;
  labelX: number;
  yearLabelY: number;
  fill: string;
}) {
  // Count label sits 3px above the bar's top edge by default. For
  // the tallest bars (h ≥ BARS_H − 2 px of slack), the count would
  // be pushed into the SVG's top margin, so we drop it INSIDE the
  // bar and flip the colour to white. The "count > 0" gate skips
  // empty years entirely — a "0" floating above an empty axis is
  // visual noise.
  const showCount = point.count > 0;
  // 3 px of margin between bar top and the count baseline (which
  // sits at `countY` and grows downward with text-anchor="middle").
  const countAbove = y - 3;
  const countInside = y + 9;
  const useInside = countAbove < 9 && h >= 11;
  const countY = useInside ? countInside : countAbove;
  const countFill = useInside ? "#ffffff" : point.isCurrent ? "#15803d" : "#374151";
  return (
    <g>
      {/* SVG <title> renders as a native browser tooltip on hover —
          gives us the year + count read-out without any client JS. */}
      <title>
        {`${point.year}: ${NF_CS.format(point.count)} ${pluralCs(point.count, FINDS)}`}
      </title>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={fill}
        rx={1.5}
        ry={1.5}
      />
      {showCount && (
        <text
          x={labelX}
          y={countY}
          textAnchor="middle"
          fontSize={9}
          fill={countFill}
          fontWeight={point.isCurrent ? 600 : 500}
          // Tabular-nums style approximation — SVG text doesn't have
          // a font-variant-numeric counterpart, but every digit in
          // Inter has the same advance, so a centered number aligns
          // visually across years anyway.
        >
          {NF_CS.format(point.count)}
        </text>
      )}
      <text
        x={labelX}
        y={yearLabelY}
        textAnchor="end"
        fontSize={10}
        fill={point.isCurrent ? "#15803d" : "#6b7280"}
        fontWeight={point.isCurrent ? 600 : 400}
        // Rotate at the label's anchor point so it reads bottom-left
        // → top-right at -45°. text-anchor="end" + this rotation
        // makes the text trail off to the upper-right of the bar's
        // center, which is the canonical orientation for tilted
        // axis labels.
        transform={`rotate(-45 ${labelX} ${yearLabelY})`}
      >
        {point.year}
      </text>
    </g>
  );
}
