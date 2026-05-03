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
  const missing = data.findsWithoutDate;
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
      {missing > 0 && (
        // Footer note explaining the gap between headline find count
        // (incl. dateless ones) and the "Rok" panel total (only
        // dated finds). Without this the difference reads as a bug.
        <p className="mt-3 text-xs text-gray-400">
          Pozn.:{" "}
          <span className="font-medium text-gray-500">
            {NF_CS.format(missing)}
          </span>{" "}
          {pluralCs(missing, FINDS)} bez EXIF data není v retrospektivě
          zahrnuto (nelze je přiřadit ke konkrétnímu roku) — celkový počet
          v sbírce je{" "}
          <span className="font-medium text-gray-500">
            {NF_CS.format(data.findsTotal)}
          </span>
          .
        </p>
      )}
    </section>
  );
}

// Chart geometry. Width is responsive (`width="100%"`); the viewBox
// stays fixed so absolute pixel maths stay simple. Height splits
// vertically: top BARS_H is the bar plot, bottom LABEL_H is room for
// the rotated year labels.
const VB_W = 320;
const BARS_H = 96;
const LABEL_H = 30;
const VB_H = BARS_H + LABEL_H;

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
        className="mt-2 h-32 w-full"
      >
        {/* Faint baseline — anchors the eye when most bars are zero
            (e.g., "Den 3.5." with one good year and the rest empty). */}
        <line
          x1={PAD_X}
          y1={BARS_H - 0.5}
          x2={VB_W - PAD_X}
          y2={BARS_H - 0.5}
          stroke="#e5e7eb"
          strokeWidth={1}
        />
        {period.points.map((p, i) => {
          const cx = PAD_X + slot * (i + 0.5);
          // Bars taller than 0 get a small minimum so non-zero years
          // are visible even when their value rounds to ~0% of `max`.
          const h = p.count === 0 ? 0 : Math.max(2, (p.count / max) * BARS_H);
          const x = cx - barW / 2;
          const y = BARS_H - h;
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
              labelY={BARS_H + 8}
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
  labelY,
  fill,
}: {
  point: RetrospectivePoint;
  x: number;
  y: number;
  w: number;
  h: number;
  labelX: number;
  labelY: number;
  fill: string;
}) {
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
      <text
        x={labelX}
        y={labelY}
        textAnchor="end"
        fontSize={10}
        fill={point.isCurrent ? "#15803d" : "#6b7280"}
        fontWeight={point.isCurrent ? 600 : 400}
        // Rotate at the label's anchor point so it reads bottom-left
        // → top-right at -45°. text-anchor="end" + this rotation
        // makes the text trail off to the upper-right of the bar's
        // center, which is the canonical orientation for tilted
        // axis labels.
        transform={`rotate(-45 ${labelX} ${labelY})`}
      >
        {point.year}
      </text>
    </g>
  );
}
