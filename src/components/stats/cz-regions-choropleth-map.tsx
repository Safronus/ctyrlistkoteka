import { geoMercator, geoPath } from "d3-geo";
import { getTranslations } from "next-intl/server";
import { getCzRegions, type CzRegionProps } from "@/lib/cz-regions";
import type { CountryPoint } from "@/lib/queries/stats";

// CZ is roughly 1.7:1 (wide); a Mercator fit at ~50° N has negligible
// distortion over an area this small.
const WIDTH = 720;
const HEIGHT = 430;

interface Props {
  /** Finds per kraj — `code` is the ISO 3166-2 region code (join key),
   *  `name` the Czech region name. */
  byKraj: readonly CountryPoint[];
}

/**
 * Choropleth of finds across the 14 Czech regions (kraje), rendered as a
 * static server-side SVG — same approach as WorldChoroplethMap. Region
 * names live in the GeoJSON properties (already Czech), so no locale
 * lookup is needed; counts are drawn at each region's centroid.
 */
export async function CzRegionsChoroplethMap({ byKraj }: Props) {
  const t = await getTranslations("Statistiky");
  const collection = getCzRegions();
  const projection = geoMercator().fitSize([WIDTH, HEIGHT], collection);
  const path = geoPath(projection);

  const max = byKraj.reduce((m, c) => Math.max(m, c.count), 0);
  const byCode = new Map<string, number>();
  for (const k of byKraj) byCode.set(k.code, k.count);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={t("geoMapRegionsAria")}
        className="block h-auto w-full"
        style={{ background: "oklch(0.92 0.02 220)" }}
      >
        {collection.features.map((feat) => {
          const props = feat.properties as CzRegionProps;
          const count = byCode.get(props.id) ?? 0;
          const d = path(feat);
          if (!d) return null;

          // Same √-scaled green ramp as the world map for visual parity.
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
                  fontSize={13}
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
