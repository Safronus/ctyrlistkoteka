import { getLocale, getTranslations } from "next-intl/server";
import type {
  RetrospectiveBundle,
  RetrospectivePeriod,
  RetrospectivePoint,
} from "@/lib/queries/retrospective";

type RetroT = Awaited<ReturnType<typeof getTranslations<"Retrospective">>>;

function toIntlLocale(locale: string): string {
  if (locale === "cs") return "cs-CZ";
  if (locale === "en") return "en-GB";
  return locale;
}

/**
 * "Retrospektiva" — 2×2 grid of compact vertical bar charts comparing
 * the visitor's current calendar position (today / ISO week / month /
 * year) across all years the collection has been active.
 */
export async function RetrospectiveGrid({
  data,
}: {
  data: RetrospectiveBundle;
}) {
  const locale = await getLocale();
  const t = await getTranslations("Retrospective");
  const intlLocale = toIntlLocale(locale);
  const monthName = new Intl.DateTimeFormat(intlLocale, {
    month: "long",
  }).format(new Date(Date.UTC(2000, data.today.month - 1, 1)));
  const numFmt = new Intl.NumberFormat(intlLocale);

  const labelFor = (period: RetrospectivePeriod): string => {
    if (period.kind === "day")
      return t("dayLabel", {
        day: data.today.day,
        month: data.today.month,
      });
    if (period.kind === "week")
      return t("weekLabel", { isoWeek: data.today.isoWeek });
    if (period.kind === "month") return t("monthLabel", { monthName });
    return t("yearLabel", { year: data.today.year });
  };

  const hintFor = (period: RetrospectivePeriod): string => {
    if (period.kind === "day")
      return t("dayHint", {
        day: data.today.day,
        month: data.today.month,
      });
    if (period.kind === "week")
      return t("weekHint", { isoWeek: data.today.isoWeek });
    if (period.kind === "month") return t("monthHint", { monthName });
    return t("yearHint");
  };

  return (
    <section className="mt-8" aria-labelledby="retro-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="retro-heading"
          className="text-xs font-semibold uppercase tracking-wide text-gray-500"
        >
          {t("heading")}
        </h2>
        <p className="text-xs text-gray-400">
          {t("anchorDate", {
            day: data.today.day,
            month: data.today.month,
            year: data.today.year,
            isoWeek: data.today.isoWeek,
          })}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <RetrospectivePanel
          period={data.day}
          label={labelFor(data.day)}
          hint={hintFor(data.day)}
          t={t}
          numFmt={numFmt}
        />
        <RetrospectivePanel
          period={data.week}
          label={labelFor(data.week)}
          hint={hintFor(data.week)}
          t={t}
          numFmt={numFmt}
        />
        <RetrospectivePanel
          period={data.month}
          label={labelFor(data.month)}
          hint={hintFor(data.month)}
          t={t}
          numFmt={numFmt}
        />
        <RetrospectivePanel
          period={data.year}
          label={labelFor(data.year)}
          hint={hintFor(data.year)}
          t={t}
          numFmt={numFmt}
        />
      </div>
    </section>
  );
}

const VB_W = 320;
const HEADROOM_H = 14;
const BARS_H = 96;
const LABEL_H = 30;
const VB_H = HEADROOM_H + BARS_H + LABEL_H;
const BAR_BASELINE = HEADROOM_H + BARS_H;

function RetrospectivePanel({
  period,
  label,
  hint,
  t,
  numFmt,
}: {
  period: RetrospectivePeriod;
  label: string;
  hint: string;
  t: RetroT;
  numFmt: Intl.NumberFormat;
}) {
  const max = Math.max(1, ...period.points.map((p) => p.count));
  const total = period.points.reduce((sum, p) => sum + p.count, 0);
  const bars = period.points.length;
  const PAD_X = 6;
  const innerW = VB_W - PAD_X * 2;
  const slot = innerW / Math.max(1, bars);
  const barW = Math.max(2, slot * 0.62);

  return (
    <article className="flex flex-col rounded-xl border border-gray-200 bg-white p-3">
      <header>
        <p className="text-base font-semibold text-gray-900">{label}</p>
        <p className="mt-0.5 text-xs text-gray-500">{hint}</p>
      </header>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={hint}
        className="mt-2 h-36 w-full"
      >
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
              t={t}
              numFmt={numFmt}
            />
          );
        })}
      </svg>
      <p className="mt-2 border-t border-gray-100 pt-2 text-right text-[11px] text-gray-500">
        {t.rich("totalSuffix", {
          count: total,
          total: () => (
            <span className="font-semibold tabular-nums text-gray-700">
              {numFmt.format(total)}
            </span>
          ),
        })}
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
  t,
  numFmt,
}: {
  point: RetrospectivePoint;
  x: number;
  y: number;
  w: number;
  h: number;
  labelX: number;
  yearLabelY: number;
  fill: string;
  t: RetroT;
  numFmt: Intl.NumberFormat;
}) {
  const showCount = point.count > 0;
  const countAbove = y - 3;
  const countInside = y + 9;
  const useInside = countAbove < 9 && h >= 11;
  const countY = useInside ? countInside : countAbove;
  const countFill = useInside
    ? "#ffffff"
    : point.isCurrent
      ? "#15803d"
      : "#374151";
  return (
    <g>
      <title>
        {t("barTitle", { year: point.year, count: point.count })}
      </title>
      <rect x={x} y={y} width={w} height={h} fill={fill} rx={1.5} ry={1.5} />
      {showCount && (
        <text
          x={labelX}
          y={countY}
          textAnchor="middle"
          fontSize={9}
          fill={countFill}
          fontWeight={point.isCurrent ? 600 : 500}
        >
          {numFmt.format(point.count)}
        </text>
      )}
      <text
        x={labelX}
        y={yearLabelY}
        textAnchor="end"
        fontSize={10}
        fill={point.isCurrent ? "#15803d" : "#6b7280"}
        fontWeight={point.isCurrent ? 600 : 400}
        transform={`rotate(-45 ${labelX} ${yearLabelY})`}
      >
        {point.year}
      </text>
    </g>
  );
}
