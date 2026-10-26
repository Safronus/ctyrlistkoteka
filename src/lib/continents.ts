/**
 * Continent membership + outline for the /statistiky continent map tabs
 * (Europe / Asia / Africa). Those tabs are the world country choropleth
 * fitted to a continent window, so without this a neighbouring country at
 * the edge looks just like a member. Membership lets the map mute the
 * non-members and trace one crisp boundary around the continent.
 *
 * Server-only (the choropleth is a server-rendered SVG), and keyed to the
 * bundled Natural Earth 110m dataset `world-atlas` ships.
 */

import { merge } from "topojson-client";
import type { Feature } from "geojson";
import type {
  GeometryCollection,
  GeometryObject,
  MultiPolygon,
  Polygon,
  Topology,
} from "topojson-specification";
import topologyData from "world-atlas/countries-110m.json";
import { alpha2FromNumeric } from "@/lib/countryCodes";

export type ContinentKey = "europe" | "asia" | "africa";

/**
 * Country membership per continent, keyed by the alpha-2 code
 * `alpha2FromNumeric` returns for this dataset. For a handful that is the
 * HISTORICAL code rather than today's — FX (France), SU (Russia), YU
 * (Serbia), UK (United Kingdom), HV (Burkina Faso), DY (Benin), TP
 * (Timor-Leste) — so these are the codes as that function actually yields
 * them, verified against the bundled 110m country list, not the modern
 * ISO forms. Transcontinental countries appear in EVERY continent they
 * span: Russia, Turkey, Cyprus, Georgia, Armenia and Azerbaijan in both
 * Europe and Asia. Egypt is kept in Africa only on purpose — putting it in
 * Asia too would colour it on the Asia tab and pull Africa into that view
 * from the west; its Sinai is small enough to let go.
 */
const MEMBERS: Record<ContinentKey, ReadonlySet<string>> = {
  europe: new Set([
    "AL", "AM", "AT", "AZ", "BY", "BE", "BA", "BG", "HR", "CY", "CZ", "DK",
    "EE", "FI", "FX", "GE", "DE", "GR", "HU", "IS", "IE", "IT", "LV", "LT",
    "LU", "MK", "MD", "ME", "NL", "NO", "PL", "PT", "RO", "SU", "YU", "SK",
    "SI", "ES", "SE", "CH", "TR", "UA", "UK",
  ]),
  asia: new Set([
    "AF", "AM", "AZ", "BD", "BT", "BN", "KH", "CN", "CY", "GE", "IN", "ID",
    "IR", "IQ", "IL", "JP", "JO", "KZ", "KW", "KG", "LA", "LB", "MY", "MN",
    "MM", "NP", "KP", "OM", "PK", "PS", "PH", "QA", "SU", "SA", "KR", "LK",
    "SY", "TW", "TJ", "TH", "TP", "TR", "TM", "AE", "UZ", "VN", "YE",
  ]),
  africa: new Set([
    "DZ", "AO", "DY", "BW", "HV", "BI", "CM", "CF", "TD", "CG", "CI", "CD",
    "DJ", "EG", "GQ", "ER", "SZ", "ET", "GA", "GM", "GH", "GN", "GW", "KE",
    "LS", "LR", "LY", "MG", "MW", "ML", "MR", "MA", "MZ", "NA", "NE", "NG",
    "RW", "SS", "SN", "SL", "SO", "ZA", "SD", "TZ", "TG", "TN", "UG", "EH",
    "ZM", "ZW",
  ]),
};

/** The three dataset features Natural Earth leaves without an ISO code —
 *  `alpha2FromNumeric` returns null and they share an empty id — matched
 *  by name instead so they still join a continent. */
const MEMBERS_BY_NAME: Record<ContinentKey, ReadonlySet<string>> = {
  europe: new Set(["Kosovo", "N. Cyprus"]),
  asia: new Set(["N. Cyprus"]),
  africa: new Set(["Somaliland"]),
};

/** Whether the country (by this dataset's numeric id, with name as the
 *  fallback for the code-less three) belongs to the continent. */
export function isContinentMember(
  continent: ContinentKey,
  id: string,
  name: string,
): boolean {
  const a2 = alpha2FromNumeric(id);
  if (a2 && MEMBERS[continent].has(a2)) return true;
  return MEMBERS_BY_NAME[continent].has(name);
}

const outlineCache: Partial<Record<ContinentKey, Feature>> = {};

/**
 * The continent's boundary as one GeoJSON Feature: the member countries'
 * TopoJSON arcs merged (internal borders dissolved) into a single
 * MultiPolygon, so the choropleth can trace one crisp outline around the
 * whole continent rather than every member's border. Cached per continent.
 */
export function getContinentOutline(continent: ContinentKey): Feature {
  const hit = outlineCache[continent];
  if (hit) return hit;
  const topo = topologyData as unknown as Topology;
  const gc = topo.objects.countries as GeometryCollection;
  // `merge` only takes areal geometries; every country in this dataset is a
  // Polygon or MultiPolygon, so the guard narrows the type and drops nothing.
  const isAreal = (g: GeometryObject): g is Polygon | MultiPolygon =>
    g.type === "Polygon" || g.type === "MultiPolygon";
  const members = gc.geometries
    .filter(isAreal)
    .filter((g) =>
      isContinentMember(
        continent,
        String(g.id ?? ""),
        (g.properties as { name?: string } | undefined)?.name ?? "",
      ),
    );
  const feature: Feature = {
    type: "Feature",
    properties: {},
    geometry: merge(topo, members),
  };
  outlineCache[continent] = feature;
  return feature;
}
