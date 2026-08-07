import {
  boundaryVertexCount,
  readBoundary,
  simplifyBoundary,
  type BoundaryGeometry,
} from "./dropBoundary";

/**
 * Looking a town's outline up in OpenStreetMap.
 *
 * This is the one place in the whole app that talks to a third party at
 * runtime, so the rules are tight:
 *   - ADMIN ONLY. A public page never reaches this code.
 *   - ONCE per area. The outline is stored on the DropArea afterwards and
 *     every later render, scatter and map draw reads the stored copy.
 *   - Only a place NAME goes out — never a find, a card, a token or a
 *     hiding coordinate.
 *
 * Nominatim's usage policy asks for an identifying User-Agent and at most
 * one request a second; a button a human presses a handful of times per
 * wave sits comfortably inside that.
 */

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const USER_AGENT =
  "Ctyrlistkoteka-admin/1.0 (+https://ctyrlistkoteka.cz; boundary lookup)";

/** Above this many vertices the outline gets thinned before storage —
 *  a Czech town commonly arrives with several thousand. */
const SIMPLIFY_ABOVE = 400;
/** ≈ 20 m. Fine enough that the drawn edge still looks like the town. */
const SIMPLIFY_TOLERANCE_DEG = 0.0002;

export interface BoundaryCandidate {
  label: string;
  /** What OSM calls this thing: "město", "kraj", "vesnice"… */
  kind: string;
  geometry: BoundaryGeometry;
  vertices: number;
}

interface NominatimHit {
  display_name?: unknown;
  class?: unknown;
  type?: unknown;
  geojson?: unknown;
  addresstype?: unknown;
  place_rank?: unknown;
}

/**
 * How specific a result is. Nominatim's `place_rank` grows as the place
 * gets smaller — a country is single digits, a town is around 16, a
 * street is in the twenties.
 *
 * This matters more than it looks: searching "Zlín" returns both the town
 * and the REGION named after it, and taking whichever polygon has more
 * vertices picks the region every time. The first version of this did
 * exactly that and quietly gave the wave a boundary the size of a county.
 */
function specificity(h: NominatimHit): number {
  const rank = Number(h.place_rank);
  return Number.isFinite(rank) ? rank : 0;
}

/** Czech words for the settlement types that actually turn up here. */
const KIND_CS: Record<string, string> = {
  city: "město",
  town: "město",
  village: "vesnice",
  hamlet: "osada",
  municipality: "obec",
  suburb: "část obce",
  borough: "městská část",
  quarter: "čtvrť",
  county: "okres",
  state: "kraj",
  region: "kraj",
  country: "stát",
  administrative: "administrativní celek",
};

/**
 * Searches for a place and returns the outlines it found, best first.
 *
 * Nominatim happily returns a point for a name it only half-recognises,
 * so anything without a real polygon is dropped rather than turned into
 * a fake one-point "boundary".
 */
export async function findBoundaries(
  query: string,
  signal?: AbortSignal,
): Promise<BoundaryCandidate[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("polygon_geojson", "1");
  url.searchParams.set("limit", "6");
  // Czech first: the towns in question are Czech and the label is read
  // by a Czech operator.
  url.searchParams.set("accept-language", "cs");

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`OSM odpověděl ${res.status}`);
  }
  const body: unknown = await res.json();
  if (!Array.isArray(body)) return [];

  const scored: Array<{ c: BoundaryCandidate; score: number }> = [];
  for (const raw of body as NominatimHit[]) {
    const geometry = readBoundary(raw.geojson);
    if (!geometry) continue; // a point or a line is not an outline
    const shrunk =
      boundaryVertexCount(geometry) > SIMPLIFY_ABOVE
        ? simplifyBoundary(geometry, SIMPLIFY_TOLERANCE_DEG)
        : geometry;
    const type = String(raw.addresstype ?? raw.type ?? "");
    scored.push({
      score: specificity(raw),
      c: {
        label: String(raw.display_name ?? query).slice(0, 300),
        kind: KIND_CS[type] ?? type ?? "?",
        geometry: shrunk,
        vertices: boundaryVertexCount(shrunk),
      },
    });
  }

  // Smallest match first: asked for a town, get the town, not the region
  // that shares its name.
  return scored.sort((a, b) => b.score - a.score).map((s) => s.c);
}
