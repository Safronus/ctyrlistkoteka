/**
 * Shared world-countries dataset: Natural Earth 110m simplification
 * shipped via the `world-atlas` npm package as TopoJSON, converted once
 * to GeoJSON and cached at the module level. Used by both the server
 * (point-in-polygon for GPS → country resolution in `geo.ts`) and the
 * client (Leaflet GeoJSON layer for the choropleth map). Bundling the
 * same module in both keeps the data source in one place; tree-shaking
 * still works because the client component dynamic-imports it through a
 * code-split chunk.
 */

import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type {
  GeometryCollection,
  Topology,
} from "topojson-specification";

// world-atlas only ships JSON files (no TS types). The import resolves
// thanks to `resolveJsonModule` in tsconfig. We immediately cast the
// loose `Topology` type so callers don't have to.
import topologyData from "world-atlas/countries-110m.json";

export interface CountryFeatureProps {
  /** ISO 3166-1 numeric code as a string (e.g. "203" = Česko). Stable
   *  React key + lookup join key for find-count maps. */
  id: string;
  /** English country name from Natural Earth, used as the join key for
   *  the Czech translation table. */
  name: string;
}

export type CountriesFC = FeatureCollection<Geometry, CountryFeatureProps>;

let cached: CountriesFC | null = null;

/**
 * Returns the world-countries FeatureCollection. The first call performs
 * the TopoJSON → GeoJSON conversion (≈10 ms in v8 for 177 countries);
 * later calls return the same instance.
 */
export function getWorldCountries(): CountriesFC {
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

/**
 * Czech display names for countries we expect to surface in the stats.
 * Keyed by Natural Earth's English `name` field (stable across the 110m
 * dataset's lifetime). Anything not in this table falls back to the
 * English name — better to show "Madagascar" than nothing at all.
 */
const CZECH_NAMES: Record<string, string> = {
  Czechia: "Česko",
  Slovakia: "Slovensko",
  Austria: "Rakousko",
  Germany: "Německo",
  Poland: "Polsko",
  Hungary: "Maďarsko",
  Ireland: "Irsko",
  "United Kingdom": "Spojené království",
  Iceland: "Island",
  France: "Francie",
  Italy: "Itálie",
  Spain: "Španělsko",
  Portugal: "Portugalsko",
  Netherlands: "Nizozemsko",
  Belgium: "Belgie",
  Luxembourg: "Lucembursko",
  Switzerland: "Švýcarsko",
  Liechtenstein: "Lichtenštejnsko",
  Slovenia: "Slovinsko",
  Croatia: "Chorvatsko",
  "Bosnia and Herz.": "Bosna a Hercegovina",
  Serbia: "Srbsko",
  Montenegro: "Černá Hora",
  Kosovo: "Kosovo",
  "N. Macedonia": "Severní Makedonie",
  Albania: "Albánie",
  Greece: "Řecko",
  Bulgaria: "Bulharsko",
  Romania: "Rumunsko",
  Moldova: "Moldavsko",
  Ukraine: "Ukrajina",
  Belarus: "Bělorusko",
  Lithuania: "Litva",
  Latvia: "Lotyšsko",
  Estonia: "Estonsko",
  Finland: "Finsko",
  Sweden: "Švédsko",
  Norway: "Norsko",
  Denmark: "Dánsko",
  Russia: "Rusko",
  Turkey: "Turecko",
  Cyprus: "Kypr",
  Malta: "Malta",
  "United States of America": "Spojené státy",
  Canada: "Kanada",
  Mexico: "Mexiko",
  Brazil: "Brazílie",
  Argentina: "Argentina",
  Australia: "Austrálie",
  "New Zealand": "Nový Zéland",
  Japan: "Japonsko",
  China: "Čína",
  India: "Indie",
};

/** Czech display name for an English country name; falls back to the
 *  input. Exposed so server stats and client tooltips agree. */
export function czechCountryName(englishName: string): string {
  return CZECH_NAMES[englishName] ?? englishName;
}
