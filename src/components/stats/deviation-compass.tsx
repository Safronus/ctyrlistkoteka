/**
 * Polar "spider" compass for the /statistiky deviation tile. Eight
 * compass points (N at the top, clockwise) over concentric grid rings,
 * with two overlaid series: the deviation COUNT per direction (filled
 * brand polygon) and the mean deviation DISTANCE per direction (dashed
 * amber outline). Each series is normalised to its own max so both fit
 * the same rings — it's a qualitative "where do finds drift, and how
 * far" picture, with exact numbers in the per-vertex tooltips.
 *
 * Pure presentational SVG, no client JS — rendered straight by the
 * server stats page.
 */

export interface CompassPoint {
  /** Short compass label, e.g. "S" / "SV" (octant order N..NW). */
  abbr: string;
  count: number;
  /** Mean deviation distance in metres, or null when empty. */
  mean: number | null;
  /** Pre-formatted hover tooltip ("severovýchod: 12 · ⌀ 24 m"). */
  tooltip: string;
  isDominant: boolean;
}

const SIZE = 240;
const C = SIZE / 2;
const R = 82;
const RINGS = [0.25, 0.5, 0.75, 1];

function at(octant: number, frac: number): [number, number] {
  const bearing = (octant * 45 * Math.PI) / 180; // 0 = N, clockwise
  const r = frac * R;
  return [C + r * Math.sin(bearing), C - r * Math.cos(bearing)];
}

export function DeviationCompass({
  points,
  countLabel,
  distanceLabel,
}: {
  points: readonly CompassPoint[];
  countLabel: string;
  distanceLabel: string;
}) {
  const maxCount = Math.max(1, ...points.map((p) => p.count));
  const maxMean = Math.max(
    1,
    ...points.map((p) => p.mean ?? 0),
  );

  const countPoly = points
    .map((p, i) => at(i, p.count / maxCount).join(","))
    .join(" ");
  const meanPoly = points
    .map((p, i) => at(i, (p.mean ?? 0) / maxMean).join(","))
    .join(" ");

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-auto w-full max-w-[260px]"
        role="img"
        aria-label={`${countLabel} / ${distanceLabel}`}
      >
        {/* Grid rings + spokes */}
        {RINGS.map((f) => (
          <circle
            key={f}
            cx={C}
            cy={C}
            r={f * R}
            className="fill-none stroke-gray-200"
            strokeWidth={1}
          />
        ))}
        {points.map((_, i) => {
          const [x, y] = at(i, 1);
          return (
            <line
              key={i}
              x1={C}
              y1={C}
              x2={x}
              y2={y}
              className="stroke-gray-200"
              strokeWidth={1}
            />
          );
        })}

        {/* Distance series — dashed amber outline. */}
        <polygon
          points={meanPoly}
          className="fill-none stroke-amber-500"
          strokeWidth={1.5}
          strokeDasharray="3 3"
        />
        {/* Count series — filled brand polygon. */}
        <polygon
          points={countPoly}
          className="fill-brand-500/20 stroke-brand-600"
          strokeWidth={1.5}
        />

        {/* Count vertices + tooltips. */}
        {points.map((p, i) => {
          const [x, y] = at(i, p.count / maxCount);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={p.isDominant ? 3.5 : 2.5}
              className={p.isDominant ? "fill-brand-700" : "fill-brand-600"}
            >
              <title>{p.tooltip}</title>
            </circle>
          );
        })}

        {/* Direction labels. */}
        {points.map((p, i) => {
          const [x, y] = at(i, 1.16);
          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className={`text-[10px] ${
                p.isDominant
                  ? "fill-brand-700 font-semibold"
                  : "fill-gray-500"
              }`}
            >
              {p.abbr}
            </text>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="mt-1 flex items-center gap-4 text-[11px] text-gray-600">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm border border-brand-600 bg-brand-500/20"
            aria-hidden
          />
          {countLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-0 w-3.5 border-t-2 border-dashed border-amber-500"
            aria-hidden
          />
          {distanceLabel}
        </span>
      </div>
    </div>
  );
}
