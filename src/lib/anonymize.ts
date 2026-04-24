import { ANON_GPS_PRECISION } from "./constants";

/**
 * Central anonymization boundary. **All find data sent to the UI must go
 * through this function** — reading `find.notes` or `find.coordinates`
 * directly in components, API routes, or meta tags would leak data.
 *
 * Rules (per CLAUDE.md §6):
 *   • Notes are nulled for anonymized finds.
 *   • GPS is either coarsened to ANON_GPS_PRECISION decimals (~100 m) or
 *     dropped entirely. We coarsen so the nález still appears on the map,
 *     just at a fuzzy location.
 *   • The caller should still avoid putting anonymized data in <meta> or
 *     OpenGraph tags. Those pages must not be statically generated for
 *     anonymized finds.
 */

export interface FindLike {
  id: number;
  isAnonymized: boolean;
  notes: string | null;
  coordinates: { lat: number; lng: number } | null;
}

export interface SafeFind<T extends FindLike> {
  /** Original record stripped of sensitive fields. */
  find: Omit<T, "notes" | "coordinates"> & {
    notes: string | null;
    coordinates: { lat: number; lng: number } | null;
    /** True if data was coarsened/hidden. Components should use this
     *  to decide whether to render markers like "Anonymized find". */
    isAnonymized: boolean;
  };
}

export function anonymize<T extends FindLike>(find: T): SafeFind<T>["find"] {
  if (!find.isAnonymized) return find;

  return {
    ...find,
    notes: null,
    coordinates: coarsenCoordinates(find.coordinates),
  };
}

export function anonymizeMany<T extends FindLike>(
  finds: readonly T[],
): Array<SafeFind<T>["find"]> {
  return finds.map(anonymize);
}

function coarsenCoordinates(
  coords: { lat: number; lng: number } | null,
): { lat: number; lng: number } | null {
  if (!coords) return null;
  const factor = 10 ** ANON_GPS_PRECISION;
  return {
    lat: Math.round(coords.lat * factor) / factor,
    lng: Math.round(coords.lng * factor) / factor,
  };
}
