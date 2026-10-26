import { geoEqualEarth, geoPath } from "d3-geo";
import type { Feature, Position } from "geojson";
import { getLocale, getTranslations } from "next-intl/server";
import {
  getWorldCountries,
  localizedCountryName,
  type CountryFeatureProps,
} from "@/lib/world-countries";
import {
  getContinentOutline,
  isContinentMember,
  type ContinentKey,
} from "@/lib/continents";
import type { CountryPoint } from "@/lib/queries/stats";

/** A continent window: fit the same country choropleth to this lng/lat
 *  rectangle, clip to the box, and set `continent` apart from the
 *  neighbours visible at the edges. `[[west, south], [east, north]]`. */
export interface MapFocus {
  bounds: [[number, number], [number, number]];
  width: number;
  height: number;
  continent: ContinentKey;
}

/**
 * Continent windows for the Europe / Asia / Africa tabs. Approximate on
 * purpose — the map is informational and shares the world's equal-area
 * projection, so these only decide framing. Neighbouring countries at the
 * edges stay visible (clipped), exactly like a page in an atlas. Tuned so
 * the continent fills its box without a distracting empty band.
 */
export const CONTINENT_FOCUS = {
  europe: { bounds: [[-26, 33], [46, 71]], width: 840, height: 640, continent: "europe" },
  // South to −12° so Indonesia (to −10.4°) and Timor aren't cut off; east to
  // 160° for Kamchatka. The box matches the window's projected aspect (1.43).
  asia: { bounds: [[25, -12], [160, 78]], width: 980, height: 686, continent: "asia" },
  africa: { bounds: [[-20, -37], [52, 39]], width: 660, height: 700, continent: "africa" },
} satisfies Record<string, MapFocus>;

interface Props {
  byCountry: readonly CountryPoint[];
  /** When set, fit + clip to this continent window instead of the whole
   *  world. */
  focus?: MapFocus;
  /** Overrides the SVG's accessible name (the continent tabs pass their
   *  own); defaults to the world "by country" label. */
  ariaLabel?: string;
}

// Default (whole-world) viewBox. The aspect ratio matches Equal Earth's
// natural extent so countries aren't squashed; pixel size is driven by
// `className="h-auto w-full"`.
const WORLD_W = 980;
const WORLD_H = 480;

/** Points sampled along the focus window's edges, as a MultiPoint, for
 *  `fitSize` to fit to. A MultiPoint (not a Polygon) on purpose: d3-geo
 *  reads a lat/lng rectangle ring by its spherical winding and, wound the
 *  "wrong" way, takes it to mean the whole globe *minus* the rectangle —
 *  which makes fitSize zoom OUT to the world. Points carry no winding, so
 *  their projected bounding box is exactly the window. Sampling the edges
 *  (not just the four corners) accounts for the projection's curvature
 *  across wide spans like Asia. */
function boundsFit([[w, s], [e, n]]: MapFocus["bounds"]): Feature {
  const STEPS = 16;
  const pts: Position[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const lng = w + ((e - w) * i) / STEPS;
    pts.push([lng, s], [lng, n]);
  }
  for (let i = 0; i <= STEPS; i++) {
    const lat = s + ((n - s) * i) / STEPS;
    pts.push([w, lat], [e, lat]);
  }
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "MultiPoint", coordinates: pts },
  };
}

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
 *
 * The continent tabs (Europe / Asia / Africa) reuse this exact renderer
 * with a `focus` window: same data, same colours, just fit to the
 * continent and clipped to the box.
 */
export async function WorldChoroplethMap({ byCountry, focus, ariaLabel }: Props) {
  const t = await getTranslations("Statistiky");
  const locale = await getLocale();
  const collection = getWorldCountries();

  const WIDTH = focus?.width ?? WORLD_W;
  const HEIGHT = focus?.height ?? WORLD_H;

  // fitSize handles centring + scale. For a continent we fit to its window
  // rectangle and clip paths to the box; for the world we fit to the whole
  // collection.
  const projection = geoEqualEarth().fitSize(
    [WIDTH, HEIGHT],
    focus ? boundsFit(focus.bounds) : collection,
  );
  if (focus) projection.clipExtent([[0, 0], [WIDTH, HEIGHT]]);
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
        aria-label={ariaLabel ?? t("geoMapAria")}
        className="block h-auto w-full"
        style={{ background: "oklch(0.92 0.02 220)" }}
      >
        {collection.features.map((feat, i) => {
          const props = feat.properties as CountryFeatureProps;
          const d = path(feat);
          // Clipped-out countries (fully outside a continent window) yield
          // no path — skip them.
          if (!d) return null;
          // `id` is empty for the three code-less features and would collide
          // as a React key, so fall back to name, then index.
          const key = props.id || props.name || String(i);

          // On a continent tab, countries that aren't part of the continent
          // are only there as edge context — paint them as flat, inert land
          // (no count colour, no tooltip) so the continent reads as the
          // subject and the neighbours recede.
          if (focus && !isContinentMember(focus.continent, props.id, props.name)) {
            return (
              <path
                key={key}
                d={d}
                fill="oklch(0.95 0.004 230)"
                stroke="oklch(0.88 0.004 230)"
                strokeWidth={0.4}
                vectorEffect="non-scaling-stroke"
              />
            );
          }

          const entry = byCode.get(props.id);
          const count = entry?.count ?? 0;
          // √-scaling so countries with a handful of finds are still
          // distinguishable from the blank landmass without making
          // every active country look identical to the dominant one.
          const intensity = max > 0 ? Math.sqrt(count / max) : 0;
          const fill =
            count > 0
              ? `oklch(${0.92 - intensity * 0.5} ${0.04 + intensity * 0.13} 145)`
              : "oklch(0.93 0.005 145)";
          const stroke =
            count > 0 ? "oklch(0.35 0.04 145)" : "oklch(0.78 0.005 145)";

          // entry.name is already localized when byCountry comes from
          // the stats page (it pre-localizes for both leaderboard +
          // tooltip consistency). For countries without finds we fall
          // back to the raw English from Natural Earth and translate
          // here so CZ users see "Madagaskar" rather than "Madagascar"
          // when hovering over an empty country.
          const label = entry?.name ?? localizedCountryName(props.name, locale);
          return (
            <path
              key={key}
              d={d}
              fill={fill}
              stroke={stroke}
              strokeWidth={count > 0 ? 0.6 : 0.5}
              vectorEffect="non-scaling-stroke"
            >
              <title>{`${label}: ${count} ${t("labelFinds", { count })}`}</title>
            </path>
          );
        })}
        {focus &&
          (() => {
            // One crisp boundary around the whole continent, drawn over the
            // fills (members' internal borders dissolved by topojson merge).
            const od = path(getContinentOutline(focus.continent));
            return od ? (
              <path
                d={od}
                fill="none"
                stroke="oklch(0.42 0.09 150)"
                strokeWidth={2.2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: "none" }}
              />
            ) : null;
          })()}
      </svg>
    </div>
  );
}
