import { geoEqualEarth, geoPath } from "d3-geo";
import { getWorldCountries, type CountryFeatureProps } from "@/lib/world-countries";
import type { CountryPoint } from "@/lib/queries/stats";

interface Props {
  byCountry: readonly CountryPoint[];
}

// SVG viewBox dimensions. The aspect ratio matches the projection's
// natural extent so countries don't get squashed; the actual pixel size
// is controlled by `className="h-auto w-full"` on the <svg> element.
const WIDTH = 980;
const HEIGHT = 480;

/**
 * Choropleth world map of finds by country, rendered as a static SVG.
 *
 * Why D3 + an inline SVG instead of Leaflet:
 *   - The Natural Earth 110m countries used by `world-atlas` contain
 *     polygons whose rings cross the antimeridian (Russia/Chukotka,
 *     Antarctica, the Aleutian arc). Leaflet's GeoJSON layer connects
 *     each ring with straight lines in projection space, which paints
 *     a horizontal stripe across the entire map at the affected
 *     latitudes. d3-geo's geoPath cuts those rings at the antimeridian
 *     before projecting, so the map renders cleanly without any extra
 *     pre-processing of the dataset.
 *   - The map on this page is informational — there's no need for tile
 *     panning or zooming. Dropping Leaflet here saves a sizeable chunk
 *     from the stats page bundle and removes the SSR-bypass dance the
 *     previous loader had to do.
 *
 * Equal Earth (Šavrič / Patterson / Jenny 2018) is an equal-area
 * projection that keeps countries' relative sizes honest while still
 * looking pleasantly map-shaped — important for a "by country"
 * choropleth where a Mercator would dwarf all of Africa.
 */
export function WorldChoroplethMap({ byCountry }: Props) {
  const collection = getWorldCountries();

  // Fit the whole world into the SVG box. fitSize handles centring +
  // scale automatically.
  const projection = geoEqualEarth().fitSize(
    [WIDTH, HEIGHT],
    collection,
  );
  const path = geoPath(projection);

  const max = byCountry.reduce((m, c) => Math.max(m, c.count), 0);
  const byCode = new Map<string, { name: string; count: number }>();
  for (const c of byCountry) byCode.set(c.code, { name: c.name, count: c.count });

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Mapa nálezů podle států"
        className="block h-auto w-full"
        style={{ background: "oklch(0.92 0.02 220)" }}
      >
        {collection.features.map((feat) => {
          const props = feat.properties as CountryFeatureProps;
          const entry = byCode.get(props.id);
          const count = entry?.count ?? 0;
          const d = path(feat);
          if (!d) return null;

          // √-scaling so countries with a handful of finds are still
          // distinguishable from the blank landmass without making
          // every active country look identical to the dominant one.
          const t = max > 0 ? Math.sqrt(count / max) : 0;
          const fill =
            count > 0
              ? `oklch(${0.92 - t * 0.5} ${0.04 + t * 0.13} 145)`
              : "oklch(0.93 0.005 145)";
          const stroke =
            count > 0 ? "oklch(0.35 0.04 145)" : "oklch(0.78 0.005 145)";

          const label = entry?.name ?? props.name;
          return (
            <path
              key={props.id}
              d={d}
              fill={fill}
              stroke={stroke}
              strokeWidth={count > 0 ? 0.6 : 0.5}
              vectorEffect="non-scaling-stroke"
            >
              <title>{`${label}: ${count} ${pluralFinds(count)}`}</title>
            </path>
          );
        })}
      </svg>
    </div>
  );
}

function pluralFinds(n: number): string {
  if (n === 1) return "nález";
  if (n >= 2 && n <= 4) return "nálezy";
  return "nálezů";
}
