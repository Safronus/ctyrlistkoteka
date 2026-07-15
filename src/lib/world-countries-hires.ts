/**
 * Higher-resolution (Natural Earth 50m) world-countries dataset, used ONLY by
 * the server-side GPS → country point-in-polygon in `geo.ts`.
 *
 * The 110m simplification in `world-countries.ts` smooths river borders enough
 * to misclassify points a few hundred metres inside a country — e.g. Štúrovo
 * (Slovakia, on the north bank of the Danube opposite Esztergom) landed inside
 * Hungary's 110m polygon. 50m places it correctly (verified: 110m → Hungary,
 * 50m → Slovakia).
 *
 * Kept in its OWN module — separate from the shared `world-countries.ts` — so
 * the ~750 KB of 50m TopoJSON stays out of the client bundle: only `geo.ts`
 * imports this, and `geo.ts` is server-only (`countryFromCoords` is never
 * pulled into a client component). The Leaflet choropleth keeps the small
 * 110m dataset, which is plenty for drawing coarse country shapes.
 */

import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
// world-atlas ships JSON only; resolveJsonModule handles the import.
import topologyData from "world-atlas/countries-50m.json";
import type { CountriesFC, CountryFeatureProps } from "@/lib/world-countries";

let cached: CountriesFC | null = null;

/**
 * Returns the 50m world-countries FeatureCollection. First call performs the
 * TopoJSON → GeoJSON conversion; later calls return the same cached instance.
 * Shares the property shape ({ id, name }) with the 110m loader so the country
 * id / name join keys and the CZECH_NAMES table apply unchanged.
 */
export function getWorldCountriesHiRes(): CountriesFC {
  if (cached) return cached;
  const topo = topologyData as unknown as Topology;
  const collection = feature(
    topo,
    topo.objects.countries as GeometryCollection,
  );
  const raw = collection as unknown as FeatureCollection<
    Geometry,
    { name?: string }
  >;
  const features: Feature<Geometry, CountryFeatureProps>[] = raw.features.map(
    (f) => ({
      type: "Feature",
      geometry: f.geometry,
      id: f.id,
      properties: {
        id: String(f.id ?? ""),
        name: f.properties?.name ?? "",
      },
    }),
  );
  cached = { type: "FeatureCollection", features };
  return cached;
}
