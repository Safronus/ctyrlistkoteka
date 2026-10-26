import { geoAlbersUsa, geoPath } from "d3-geo";
import { getTranslations } from "next-intl/server";
import { getUsStates, type UsStateProps } from "@/lib/us-states";
import type { CountryPoint } from "@/lib/queries/stats";

// geoAlbersUsa is a composite ~1.75:1 layout (continental US + Alaska and
// Hawaii insets at the lower left). fitSize rescales it into this box.
const WIDTH = 960;
const HEIGHT = 560;

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
 */
export async function UsStatesChoroplethMap({ byState }: Props) {
  const t = await getTranslations("Statistiky");
  const collection = getUsStates();
  const projection = geoAlbersUsa().fitSize([WIDTH, HEIGHT], collection);
  const path = geoPath(projection);

  const max = byState.reduce((m, s) => Math.max(m, s.count), 0);
  const byCode = new Map<string, number>();
  for (const s of byState) byCode.set(s.code, s.count);

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
        {collection.features.map((feat) => {
          const props = feat.properties as UsStateProps;
          const count = byCode.get(props.id) ?? 0;
          const d = path(feat);
          if (!d) return null;

          const intensity = max > 0 ? Math.sqrt(count / max) : 0;
          const fill =
            count > 0
              ? `oklch(${0.92 - intensity * 0.5} ${0.04 + intensity * 0.13} 145)`
              : "oklch(0.93 0.005 145)";
          const stroke =
            count > 0 ? "oklch(0.32 0.04 145)" : "oklch(0.62 0.02 145)";
          const [cx, cy] = path.centroid(feat);
          const showCount = count > 0 && Number.isFinite(cx);
          return (
            <g key={props.id}>
              <path
                d={d}
                fill={fill}
                stroke={stroke}
                strokeWidth={0.8}
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${props.name}: ${count} ${t("labelFinds", { count })}`}</title>
              </path>
              {showCount && (
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={12}
                  fontWeight={600}
                  fill={intensity > 0.55 ? "#ffffff" : "oklch(0.28 0.05 145)"}
                  style={{ pointerEvents: "none" }}
                >
                  {count}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
