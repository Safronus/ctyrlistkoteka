/**
 * Continent membership for the /statistiky continent map tabs. Those maps
 * are the world country choropleth fitted to a continent window, so without
 * this a neighbouring country at the edge would look just like a member;
 * membership lets the map mute the non-members and trace the continent's
 * own boundary.
 *
 * Keyed to the Natural Earth datasets `world-atlas` ships (the 50m one the
 * continent maps draw, which is a superset of the 110m one). Light on
 * purpose — no geometry here; that lives in `continentMap.ts`.
 */

import { alpha2FromNumeric } from "@/lib/countryCodes";

export const CONTINENT_KEYS = [
  "europe",
  "asia",
  "africa",
  "northAmerica",
  "southAmerica",
  "oceania",
] as const;
export type ContinentKey = (typeof CONTINENT_KEYS)[number];

export function isContinentKey(v: string): v is ContinentKey {
  return (CONTINENT_KEYS as readonly string[]).includes(v);
}

/** Map window + SVG box per continent tab. Lives here (not in
 *  `continentMap.ts`) so the page can size the lazy-load placeholder without
 *  importing the 50m topology. */
export interface ContinentFrame {
  /** Window to fit, `[[west, south], [east, north]]` in degrees. East may
   *  exceed 180 to cross the antimeridian (Oceania). */
  bounds: [[number, number], [number, number]];
  /** SVG viewBox. Tall continents get a box somewhat wider than their
   *  window, so they show a little context instead of a 1.3 m tall map. */
  width: number;
  height: number;
}

export const CONTINENT_FRAME: Record<ContinentKey, ContinentFrame> = {
  europe: { bounds: [[-26, 33], [46, 71]], width: 840, height: 640 },
  // South to −12° for Indonesia (to −10.4°) and Timor; east to 160° for
  // Kamchatka.
  asia: { bounds: [[25, -12], [160, 78]], width: 980, height: 733 },
  africa: { bounds: [[-20, -37], [52, 39]], width: 660, height: 700 },
  northAmerica: { bounds: [[-170, 7], [-12, 84]], width: 980, height: 520 },
  southAmerica: { bounds: [[-92, -56], [-30, 13]], width: 760, height: 860 },
  oceania: { bounds: [[110, -48], [190, -1]], width: 980, height: 725 },
};

/**
 * Country membership per continent, keyed by the alpha-2 code
 * `alpha2FromNumeric` returns for the dataset. For a handful that is the
 * HISTORICAL code rather than today's — FX (France), SU (Russia), YU
 * (Serbia), UK (United Kingdom), HV (Burkina Faso), DY (Benin), TP
 * (Timor-Leste) — so these are the codes as that function actually yields
 * them, verified against the bundled country list, not the modern ISO forms.
 *
 * Russia, Kazakhstan, Turkey, Georgia and Azerbaijan straddle the
 * Europe–Asia line and sit in BOTH sets; the map then draws only the part
 * on the right side of the line (see `TRANSCONTINENTAL` and
 * `continentMap.ts`). Everything else belongs to exactly one continent:
 * Armenia lies wholly south of the Caucasus crest (Asia); Cyprus is kept in
 * Europe (EU member) rather than split; Egypt stays in Africa so the Asia
 * tab doesn't pull Africa in from the west. France's feature includes French
 * Guiana, so on the South America tab that territory reads as "not a member".
 */
const MEMBERS: Record<ContinentKey, ReadonlySet<string>> = {
  europe: new Set([
    "AD", "AL", "AT", "AX", "AZ", "BA", "BE", "BG", "BY", "CH", "CY", "CZ",
    "DE", "DK", "EE", "ES", "FI", "FO", "FX", "GE", "GG", "GR", "HR", "HU",
    "IE", "IM", "IS", "IT", "JE", "KZ", "LI", "LT", "LU", "LV", "MC", "MD",
    "ME", "MK", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK", "SM",
    "SU", "TR", "UA", "UK", "VA", "YU",
  ]),
  asia: new Set([
    "AE", "AF", "AM", "AZ", "BD", "BH", "BN", "BT", "CN", "GE", "HK", "ID",
    "IL", "IN", "IQ", "IR", "JO", "JP", "KG", "KH", "KP", "KR", "KW", "KZ",
    "LA", "LB", "LK", "MM", "MN", "MO", "MV", "MY", "NP", "OM", "PH", "PK",
    "PS", "QA", "SA", "SG", "SU", "SY", "TH", "TJ", "TM", "TP", "TR", "TW",
    "UZ", "VN", "YE",
  ]),
  africa: new Set([
    "AO", "BI", "BW", "CD", "CF", "CG", "CI", "CM", "CV", "DJ", "DY", "DZ",
    "EG", "EH", "ER", "ET", "GA", "GH", "GM", "GN", "GQ", "GW", "HV", "KE",
    "KM", "LR", "LS", "LY", "MA", "MG", "ML", "MR", "MU", "MW", "MZ", "NA",
    "NE", "NG", "RW", "SC", "SD", "SH", "SL", "SN", "SO", "SS", "ST", "SZ",
    "TD", "TG", "TN", "TZ", "UG", "ZA", "ZM", "ZW",
  ]),
  northAmerica: new Set([
    "AG", "AI", "AW", "BB", "BL", "BM", "BS", "BZ", "CA", "CR", "CU", "CW",
    "DM", "DO", "GD", "GL", "GT", "HN", "HT", "JM", "KN", "KY", "LC", "MF",
    "MS", "MX", "NI", "PA", "PM", "PR", "SV", "SX", "TC", "TT", "US", "VC",
    "VG", "VI",
  ]),
  southAmerica: new Set([
    "AR", "BO", "BR", "CL", "CO", "EC", "FK", "GS", "GY", "PE", "PY", "SR",
    "UY", "VE",
  ]),
  oceania: new Set([
    "AS", "AU", "CK", "FJ", "FM", "GU", "KI", "MH", "MP", "NC", "NF", "NR",
    "NU", "NZ", "PF", "PG", "PN", "PW", "SB", "TO", "VU", "WF", "WS",
  ]),
};

/** Dataset features Natural Earth leaves without an ISO code
 *  (`alpha2FromNumeric` returns null and they share an empty id), matched
 *  by name instead so they still join a continent. */
const MEMBERS_BY_NAME: Record<ContinentKey, ReadonlySet<string>> = {
  europe: new Set(["Kosovo", "N. Cyprus"]),
  asia: new Set(["Siachen Glacier"]),
  africa: new Set(["Somaliland"]),
  northAmerica: new Set(),
  southAmerica: new Set(),
  oceania: new Set(["Indian Ocean Ter."]),
};

/** Countries the Europe–Asia line cuts through. On the Europe and Asia
 *  maps these are drawn only on their own side of the line. */
const TRANSCONTINENTAL: ReadonlySet<string> = new Set(["SU", "KZ", "TR", "GE", "AZ"]);

/** Whether the country (by the dataset's numeric id, with name as the
 *  fallback for the code-less ones) belongs to the continent. */
export function isContinentMember(
  continent: ContinentKey,
  id: string,
  name: string,
): boolean {
  const a2 = alpha2FromNumeric(id);
  if (a2 && MEMBERS[continent].has(a2)) return true;
  return MEMBERS_BY_NAME[continent].has(name);
}

/** Whether the country straddles the Europe–Asia line. */
export function isTranscontinental(id: string): boolean {
  const a2 = alpha2FromNumeric(id);
  return a2 !== null && TRANSCONTINENTAL.has(a2);
}
