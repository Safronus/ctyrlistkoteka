/**
 * Offline GPS → country resolver. We deliberately *don't* call Nominatim
 * or any other reverse-geocoding service: the data is small (≈128 known
 * locations, growing slowly), the user's collection is overwhelmingly
 * Czech, and a bounding-box check covers every country we've seen so far
 * without adding a network dependency or a schema migration.
 *
 * If the data ever spans many more borderline cases (Vienna ↔ Bratislava,
 * Ireland's coast, Iberian coast, …), promote this to either:
 *   1. a one-time enrichment step in `scripts/sync.ts` that calls
 *      Nominatim and stores the country code on `Location`, or
 *   2. a PostGIS table loaded from Natural Earth and queried with
 *      `ST_Contains(country.geom, location.center_point)`.
 *
 * Both paths preserve the public surface of `countryFromCoords`.
 */

interface CountryEntry {
  /** ISO 3166-1 alpha-2 — used as React keys and (later) flag emojis. */
  code: string;
  /** Czech name shown in the stats table. */
  name: string;
  /** [southLat, westLng, northLat, eastLng]. */
  bbox: [number, number, number, number];
  /** Approximate centroid — tiebreaker for points inside multiple
   *  bounding boxes (border regions). */
  centroid: [number, number];
}

// Curated list of countries the collection has touched (or is plausibly
// about to). Add new entries here when a new country shows up; the order
// doesn't matter — `countryFromCoords` picks by closest centroid.
const COUNTRIES: readonly CountryEntry[] = [
  { code: "CZ", name: "Česko", bbox: [48.5, 12.0, 51.1, 18.9], centroid: [49.8, 15.5] },
  { code: "SK", name: "Slovensko", bbox: [47.7, 16.8, 49.6, 22.6], centroid: [48.7, 19.7] },
  { code: "AT", name: "Rakousko", bbox: [46.4, 9.5, 49.0, 17.2], centroid: [47.6, 13.3] },
  { code: "DE", name: "Německo", bbox: [47.3, 5.9, 55.1, 15.0], centroid: [51.1, 10.4] },
  { code: "PL", name: "Polsko", bbox: [49.0, 14.1, 54.9, 24.2], centroid: [51.9, 19.1] },
  { code: "HU", name: "Maďarsko", bbox: [45.7, 16.1, 48.6, 22.9], centroid: [47.2, 19.5] },
  { code: "IE", name: "Irsko", bbox: [51.4, -10.8, 55.5, -5.4], centroid: [53.4, -8.2] },
  { code: "GB", name: "Spojené království", bbox: [49.9, -8.2, 60.9, 1.8], centroid: [54.0, -2.5] },
  { code: "IS", name: "Island", bbox: [63.3, -25.0, 66.6, -13.5], centroid: [64.9, -19.0] },
  { code: "FR", name: "Francie", bbox: [41.3, -5.1, 51.1, 9.6], centroid: [46.6, 2.2] },
  { code: "IT", name: "Itálie", bbox: [35.5, 6.6, 47.1, 18.5], centroid: [42.5, 12.8] },
  { code: "ES", name: "Španělsko", bbox: [27.6, -18.2, 43.8, 4.3], centroid: [40.0, -3.7] },
  { code: "NL", name: "Nizozemsko", bbox: [50.7, 3.4, 53.6, 7.2], centroid: [52.1, 5.3] },
  { code: "BE", name: "Belgie", bbox: [49.5, 2.5, 51.5, 6.4], centroid: [50.5, 4.5] },
  { code: "CH", name: "Švýcarsko", bbox: [45.8, 5.9, 47.8, 10.5], centroid: [46.8, 8.2] },
  { code: "SI", name: "Slovinsko", bbox: [45.4, 13.4, 46.9, 16.6], centroid: [46.1, 14.8] },
  { code: "HR", name: "Chorvatsko", bbox: [42.4, 13.5, 46.6, 19.4], centroid: [45.1, 15.2] },
];

const UNKNOWN_COUNTRY = { code: "??", name: "Jinde" } as const;

export interface CountryRef {
  code: string;
  name: string;
}

/**
 * Returns the most likely country for the given lat/lng. When several
 * countries' bounding boxes overlap a point (border regions), the one
 * whose centroid sits closest wins. Returns `{code: "??", name: "Jinde"}`
 * for points outside every known box — keeping a stable string so the
 * stats page can still group them.
 */
export function countryFromCoords(lat: number, lng: number): CountryRef {
  const inBoxes = COUNTRIES.filter(
    (c) =>
      lat >= c.bbox[0] &&
      lat <= c.bbox[2] &&
      lng >= c.bbox[1] &&
      lng <= c.bbox[3],
  );
  if (inBoxes.length === 0) return { ...UNKNOWN_COUNTRY };
  if (inBoxes.length === 1) {
    const only = inBoxes[0]!;
    return { code: only.code, name: only.name };
  }
  const ranked = [...inBoxes].sort(
    (a, b) =>
      sqDist(a.centroid, lat, lng) - sqDist(b.centroid, lat, lng),
  );
  const winner = ranked[0]!;
  return { code: winner.code, name: winner.name };
}

function sqDist(centroid: readonly [number, number], lat: number, lng: number): number {
  const dy = centroid[0] - lat;
  const dx = centroid[1] - lng;
  return dy * dy + dx * dx;
}
