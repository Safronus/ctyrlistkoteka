import { geoAlbersUsa, geoPath } from "d3-geo";
import { getTranslations } from "next-intl/server";
import { getUsStates, type UsStateProps } from "@/lib/us-states";
import type { CountryPoint } from "@/lib/queries/stats";

// geoAlbersUsa is a composite ~1.75:1 layout (continental US + Alaska and
// Hawaii insets at the lower left). fitSize rescales it into this box.
const WIDTH = 960;
const HEIGHT = 560;
const LABEL_FONT = 12;
// A state whose drawn shape is smaller than this (either side, viewBox
// units) can't show its fill — DC is ~4 units. It gets a marker instead.
const TINY_FEATURE = 12;
// Marker radius: room for the count's digits at LABEL_FONT.
const markerRadius = (count: number) => 6 + 3.5 * String(count).length;

interface Props {
  /** Finds per US state — `code` is the 2-digit FIPS code (join key),
   *  `name` the English state name. Empty until the first US find. */
  byState: readonly CountryPoint[];
}

/**
 * Choropleth of finds across the 50 US states + DC, rendered as a static
 * server-side SVG — the American counterpart of CzRegionsChoroplethMap and
 * the same format: counts drawn at each state's centroid, same √-scaled
 * green ramp. Alaska and Hawaii ride in geoAlbersUsa's built-in insets.
 * State names come straight from the dataset (English); empty until a US
 * find appears, which is expected.
 *
 * Counts are drawn in a second pass, after every shape: SVG paints in
 * document order, so a count drawn with its own state was covered by
 * neighbours painted later (DC's „61" vanished under Maryland and
 * Virginia). A state too small to show its fill (DC) gets a green marker
 * with the count inside instead.
 */
export async function UsStatesChoroplethMap({ byState }: Props) {
  const t = await getTranslations("Statistiky");
  const collection = getUsStates();
  const projection = geoAlbersUsa().fitSize([WIDTH, HEIGHT], collection);
  const path = geoPath(projection);

  const max = byState.reduce((m, s) => Math.max(m, s.count), 0);
  const byCode = new Map<string, number>();
  for (const s of byState) byCode.set(s.code, s.count);

  const states = collection.features.flatMap((feat) => {
    const props = feat.properties as UsStateProps;
    const d = path(feat);
    if (!d) return [];
    const count = byCode.get(props.id) ?? 0;
    const intensity = max > 0 ? Math.sqrt(count / max) : 0;
    const fill =
      count > 0
        ? `oklch(${0.92 - intensity * 0.5} ${0.04 + intensity * 0.13} 145)`
        : "oklch(0.93 0.005 145)";
    const stroke =
      count > 0 ? "oklch(0.32 0.04 145)" : "oklch(0.62 0.02 145)";
    const [[x0, y0], [x1, y1]] = path.bounds(feat);
    const [cx, cy] = path.centroid(feat);
    return [
      {
        props,
        d,
        count,
        intensity,
        fill,
        stroke,
        cx,
        cy,
        title: `${props.name}: ${count} ${t("labelFinds", { count })}`,
        tiny: Math.max(x1 - x0, y1 - y0) < TINY_FEATURE,
        showCount: count > 0 && Number.isFinite(cx),
      },
    ];
  });

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={t("geoMapStatesUsaAria")}
        className="block h-auto w-full"
        style={{ background: "oklch(0.92 0.02 220)" }}
      >
        {states.map((s) => (
          <g key={s.props.id}>
            <path
              d={s.d}
              fill={s.fill}
              stroke={s.stroke}
              strokeWidth={0.8}
              vectorEffect="non-scaling-stroke"
            >
              <title>{s.title}</title>
            </path>
          </g>
        ))}
        {states
          .filter((s) => s.showCount)
          .map((s) => (
            <g key={`label-${s.props.id}`}>
              {s.tiny && (
                <circle
                  cx={s.cx}
                  cy={s.cy}
                  r={markerRadius(s.count)}
                  fill={s.fill}
                  stroke={s.stroke}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{s.title}</title>
                </circle>
              )}
              <text
                x={s.cx}
                y={s.cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={LABEL_FONT}
                fontWeight={600}
                fill={s.intensity > 0.55 ? "#ffffff" : "oklch(0.28 0.05 145)"}
                style={{ pointerEvents: "none" }}
              >
                {s.count}
              </text>
            </g>
          ))}
      </svg>
    </div>
  );
}
