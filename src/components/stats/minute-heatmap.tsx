"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MinuteHeatmapCell } from "@/lib/queries/stats";

export type BinMinutes = 1 | 5 | 15 | 60;

/** Bins surfaced in the granularity dropdown. 1440 is divisible by every
 *  value so cell-width math stays integer-clean on the same total-width
 *  canvas. */
export const BIN_OPTIONS: readonly BinMinutes[] = [1, 5, 15, 60];

// Grid constants. The canvas keeps the same CSS dimensions regardless
// of bin — each bin only changes cell-width to match.
const TOTAL_MINUTES_PER_DAY = 1440;
const TOTAL_WIDTH_PX = 1440;
const DAY_HEIGHT_PX = 2;
const DAYS = 366;
const TOTAL_HEIGHT_PX = DAYS * DAY_HEIGHT_PX; // 732

/** Reference leap year so doy 60 = Feb 29 lands correctly. Used only
 *  for the tooltip date display — pure presentation. */
const REFERENCE_LEAP_YEAR = 2024;

// Greens follow the same oklch family (chroma=145°) as the existing
// MonthDayHeatmap so the two views feel like one tool. Stops are log-
// spaced because the data is extremely sparse (most minutes have 0–1
// finds, with a long thin tail above).
const COLOUR_EMPTY = "oklch(0.97 0.04 145)";
const COLOUR_TICK = "oklch(0.85 0.02 145)";

function colourForCount(count: number, maxCount: number): string {
  if (count <= 0) return COLOUR_EMPTY;
  if (maxCount <= 1) return "oklch(0.55 0.16 145)";
  // log(count+1)/log(max+1) maps [1..max] → [0..1] non-linearly so a
  // 2-count cell still has visible green even when max sits in the 10s.
  const t = Math.log(count + 1) / Math.log(maxCount + 1);
  const L = 0.92 - t * 0.52; // 0.92 (very light) → 0.40 (deep green)
  const C = 0.05 + t * 0.13;
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} 145)`;
}

function doyToDate(doy: number): { month: number; day: number } {
  // JS Date overflow is forgiving — `new Date(year, 0, 366)` resolves
  // to Dec 31 in a non-leap year; we always use a leap year so we
  // round-trip cleanly when doy = 60 (Feb 29).
  const d = new Date(REFERENCE_LEAP_YEAR, 0, doy);
  return { month: d.getMonth() + 1, day: d.getDate() };
}

function minuteToHHMM(mod: number): string {
  const h = Math.floor(mod / 60);
  const m = mod % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatTimeRange(modStart: number, bin: BinMinutes): string {
  if (bin === 1) return minuteToHHMM(modStart);
  // End-exclusive so two adjacent bins read as "...09:55–10:00" + "10:00–10:05"
  // rather than overlapping on the boundary minute.
  const end = Math.min(modStart + bin, TOTAL_MINUTES_PER_DAY);
  return `${minuteToHHMM(modStart)}–${minuteToHHMM(end)}`;
}

interface BucketedCell {
  doy: number;
  /** Start-of-bin minute-of-day. */
  modBin: number;
  count: number;
}

function bucketCells(
  cells: readonly MinuteHeatmapCell[],
  bin: BinMinutes,
): { buckets: BucketedCell[]; maxCount: number; total: number } {
  if (bin === 1) {
    let max = 0;
    let total = 0;
    const buckets: BucketedCell[] = cells.map((c) => {
      if (c.count > max) max = c.count;
      total += c.count;
      return { doy: c.doy, modBin: c.mod, count: c.count };
    });
    return { buckets, maxCount: max, total };
  }
  const key = (doy: number, modBin: number) => doy * 10000 + modBin;
  const acc = new Map<number, BucketedCell>();
  let total = 0;
  for (const c of cells) {
    const modBin = Math.floor(c.mod / bin) * bin;
    const k = key(c.doy, modBin);
    const cur = acc.get(k);
    if (cur) cur.count += c.count;
    else acc.set(k, { doy: c.doy, modBin, count: c.count });
    total += c.count;
  }
  let max = 0;
  for (const v of acc.values()) {
    if (v.count > max) max = v.count;
  }
  return { buckets: [...acc.values()], maxCount: max, total };
}

interface HoverInfo {
  doy: number;
  modBin: number;
  count: number;
  /** Logical (canvas-space) coordinates in px — relative to TOTAL_WIDTH/HEIGHT. */
  pxX: number;
  pxY: number;
}

interface Props {
  cells: readonly MinuteHeatmapCell[];
  initialBin?: BinMinutes;
}

export function MinuteHeatmap({ cells, initialBin = 5 }: Props) {
  const t = useTranslations("Statistiky");
  const [bin, setBin] = useState<BinMinutes>(initialBin);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const { buckets, maxCount, total } = useMemo(
    () => bucketCells(cells, bin),
    [cells, bin],
  );

  const cellWidthPx = TOTAL_WIDTH_PX / (TOTAL_MINUTES_PER_DAY / bin);

  // (doy, modBin) → count lookup, used to resolve tooltip data without
  // re-walking the bucket array on every mouse move.
  const bucketIndex = useMemo(() => {
    const idx = new Map<number, number>();
    for (const b of buckets) {
      idx.set(b.doy * 10000 + b.modBin, b.count);
    }
    return idx;
  }, [buckets]);

  // Canvas paint. DPR scaling keeps it sharp on Retina without changing
  // the CSS footprint. Only non-zero cells are over-painted; the bulk
  // empty background fills as one solid rect first.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(TOTAL_WIDTH_PX * dpr);
    canvas.height = Math.floor(TOTAL_HEIGHT_PX * dpr);
    canvas.style.width = `${TOTAL_WIDTH_PX}px`;
    canvas.style.height = `${TOTAL_HEIGHT_PX}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = COLOUR_EMPTY;
    ctx.fillRect(0, 0, TOTAL_WIDTH_PX, TOTAL_HEIGHT_PX);

    for (const b of buckets) {
      const x = (b.modBin / bin) * cellWidthPx;
      const y = (b.doy - 1) * DAY_HEIGHT_PX;
      ctx.fillStyle = colourForCount(b.count, maxCount);
      ctx.fillRect(x, y, cellWidthPx, DAY_HEIGHT_PX);
    }

    // Faint overlay grid. Vertical 1px every 3 h, horizontal 1px at
    // the start of each month so the viewer can orient without needing
    // tick labels along the sides.
    ctx.fillStyle = COLOUR_TICK;
    const hourInterval = 180; // 3 h
    for (let m = hourInterval; m < TOTAL_MINUTES_PER_DAY; m += hourInterval) {
      const x = (m / bin) * cellWidthPx;
      ctx.fillRect(x, 0, 1, TOTAL_HEIGHT_PX);
    }
    const monthFirsts = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
    for (let i = 1; i < monthFirsts.length; i++) {
      const y = (monthFirsts[i]! - 1) * DAY_HEIGHT_PX;
      ctx.fillRect(0, y, TOTAL_WIDTH_PX, 1);
    }
  }, [buckets, bin, cellWidthPx, maxCount]);

  const handleMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      // Translate viewport coords → logical 1440×732 grid. CSS may
      // scale the canvas down on narrow viewports — divide by the
      // ratio so tooltips track correctly on mobile too.
      const scaleX = TOTAL_WIDTH_PX / rect.width;
      const scaleY = TOTAL_HEIGHT_PX / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      if (x < 0 || x >= TOTAL_WIDTH_PX || y < 0 || y >= TOTAL_HEIGHT_PX) {
        setHover(null);
        return;
      }
      const colIdx = Math.floor(x / cellWidthPx);
      const modBin = colIdx * bin;
      const doy = Math.floor(y / DAY_HEIGHT_PX) + 1;
      const count = bucketIndex.get(doy * 10000 + modBin) ?? 0;
      setHover({ doy, modBin, count, pxX: x, pxY: y });
    },
    [bin, bucketIndex, cellWidthPx],
  );

  const handleLeave = useCallback(() => setHover(null), []);

  if (cells.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
        {t("minuteHeatmapEmpty")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-xs text-gray-600">
          <span>{t("minuteHeatmapBinLabel")}</span>
          <select
            value={bin}
            onChange={(e) => setBin(Number(e.target.value) as BinMinutes)}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
          >
            {BIN_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {t(`minuteHeatmapBin${b}`)}
              </option>
            ))}
          </select>
        </label>
        <span className="text-[11px] text-gray-500">
          {t("minuteHeatmapLegendMax")}: <strong>{maxCount}</strong> ·{" "}
          {t("minuteHeatmapLegendTotal")}: <strong>{total}</strong>
        </span>
        <LegendStrip maxCount={maxCount} />
      </div>

      <div className="relative overflow-x-auto">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
          // display:block avoids the inline-image baseline gap that
          // would put a stray pixel under the canvas and break the
          // bottom border alignment.
          className="block max-w-none border border-gray-200 bg-white"
          aria-label={t("minuteHeatmapAriaLabel")}
        />
        {hover && (
          <HoverTooltip
            hover={hover}
            bin={bin}
            canvasWidth={TOTAL_WIDTH_PX}
            canvasHeight={TOTAL_HEIGHT_PX}
          />
        )}
      </div>

      <p className="text-[11px] text-gray-500">
        {t("minuteHeatmapAxisLegend")}
      </p>
    </div>
  );
}

function LegendStrip({ maxCount }: { maxCount: number }) {
  // Five swatches: empty + four log-ish stops up to max. We compute the
  // stops as quartiles of max but clamp them to integers ≥ 1 so the
  // legend isn't all zeros for low-volume data.
  const stops = [
    0,
    1,
    Math.max(2, Math.ceil(maxCount / 4)),
    Math.max(3, Math.ceil(maxCount / 2)),
    Math.max(4, maxCount),
  ];
  return (
    <div className="inline-flex items-center gap-1 text-[10px] text-gray-500">
      <span>0</span>
      {stops.map((s, i) => (
        <span
          key={i}
          className="inline-block h-3 w-3 rounded-sm border border-gray-200"
          style={{ backgroundColor: colourForCount(s, maxCount) }}
          title={String(s)}
        />
      ))}
      <span>{maxCount}</span>
    </div>
  );
}

function HoverTooltip({
  hover,
  bin,
  canvasWidth,
  canvasHeight,
}: {
  hover: HoverInfo;
  bin: BinMinutes;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const t = useTranslations("Statistiky");
  const { month, day } = doyToDate(hover.doy);
  const monthName = t(`monthLong${month}`);
  const timeText = formatTimeRange(hover.modBin, bin);

  // Position relative to canvas; flip to the left/above when near the
  // right/bottom edge so the tooltip stays inside the viewport.
  const flipX = hover.pxX > canvasWidth * 0.75;
  const flipY = hover.pxY > canvasHeight * 0.75;
  const style: React.CSSProperties = {
    position: "absolute",
    left: flipX ? undefined : `${(hover.pxX / canvasWidth) * 100}%`,
    right: flipX
      ? `${((canvasWidth - hover.pxX) / canvasWidth) * 100}%`
      : undefined,
    top: flipY ? undefined : `${(hover.pxY / canvasHeight) * 100}%`,
    bottom: flipY
      ? `${((canvasHeight - hover.pxY) / canvasHeight) * 100}%`
      : undefined,
    transform: `translate(${flipX ? "-8px" : "8px"}, ${
      flipY ? "-8px" : "8px"
    })`,
    pointerEvents: "none",
  };

  return (
    <div
      style={style}
      className="z-10 whitespace-nowrap rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 shadow-md"
    >
      <div className="font-medium text-gray-900">
        {day}. {monthName}, {timeText}
      </div>
      <div className="text-gray-600">
        {t("labelFinds", { count: hover.count })}
      </div>
    </div>
  );
}
