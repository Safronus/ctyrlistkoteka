/**
 * Eight directions around a fixed origin, each labelled with the farthest (or
 * nearest) find that way.
 *
 * Deliberately NOT a proportional shape, unlike the deviation compass. The
 * collection spans metres (the next street) to thousands of kilometres
 * (Japan), so any radius scaled to distance collapses seven of the eight
 * spokes into the centre and draws a single spike — that's what a linear rose
 * did here. A logarithmic radius would have fixed the picture at the cost of
 * a chart whose lengths mean nothing intuitive, so the owner's call was to
 * drop the shape entirely: equal spokes, the number written out.
 *
 * Pure presentational SVG, no client JS of its own.
 */

export interface DistanceRosePoint {
  /** Short compass label, e.g. "S" / "SV" (octant order N..NW). */
  abbr: string;
  /** Pre-formatted distance ("8 976 km"), or null for a direction with no
   *  finds — drawn dimmed with an em dash. */
  value: string | null;
  /** Full tooltip, e.g. "severovýchod: 8 976 km". */
  tooltip: string;
  /** True for the direction holding the overall record. */
  isRecord: boolean;
}

const SIZE = 240;
const C = SIZE / 2;
/** Spoke length. Short on purpose — the labels need the outer ring. */
const R = 52;

function at(octant: number, r: number): [number, number] {
  const bearing = (octant * 45 * Math.PI) / 180; // 0 = N, clockwise
  return [C + r * Math.sin(bearing), C - r * Math.cos(bearing)];
}

export function DistanceRose({
  points,
  legend,
}: {
  points: readonly DistanceRosePoint[];
  /** Accessible name for the SVG only — not drawn. The spokes label
   *  themselves, and the card's own toggle already says which end
   *  ("nejbližší" / "nejvzdálenější") is being shown. */
  legend: string;
}) {
  return (
    <div className="flex w-full flex-col items-center">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-auto w-full max-w-[240px]"
        role="img"
        aria-label={legend}
      >
        {points.map((p, i) => {
          const [x, y] = at(i, R);
          const [lx, ly] = at(i, R + 20);
          const empty = p.value === null;
          return (
            <g key={i}>
              <line
                x1={C}
                y1={C}
                x2={x}
                y2={y}
                className={
                  empty
                    ? "stroke-gray-200"
                    : p.isRecord
                      ? "stroke-brand-700"
                      : "stroke-brand-500"
                }
                strokeWidth={p.isRecord ? 2.5 : 1.5}
              />
              {!empty && (
                <circle
                  cx={x}
                  cy={y}
                  r={p.isRecord ? 4 : 2.5}
                  className={p.isRecord ? "fill-brand-700" : "fill-brand-500"}
                />
              )}
              {/* Direction over the value, both anchored on the spoke's
                  bearing so opposite sides don't collide. */}
              <text
                x={lx}
                y={ly - 6}
                textAnchor="middle"
                dominantBaseline="middle"
                className={`text-[13px] ${
                  p.isRecord
                    ? "fill-brand-700 font-bold"
                    : empty
                      ? "fill-gray-300"
                      : "fill-gray-500"
                }`}
              >
                {p.abbr}
              </text>
              <text
                x={lx}
                y={ly + 8}
                textAnchor="middle"
                dominantBaseline="middle"
                className={`text-[12px] tabular-nums ${
                  p.isRecord
                    ? "fill-brand-700 font-semibold"
                    : empty
                      ? "fill-gray-300"
                      : "fill-gray-700"
                }`}
              >
                {p.value ?? "—"}
              </text>
              <title>{p.tooltip}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
