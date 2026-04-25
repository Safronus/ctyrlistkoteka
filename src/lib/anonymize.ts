/**
 * Central anonymization boundary. **All find data sent to the UI must go
 * through this function** — reading `find.notes` or `find.coordinates`
 * directly in components, API routes, or meta tags would leak data.
 *
 * Rules (per CLAUDE.md §6):
 *   • Notes are nulled for anonymized finds.
 *   • GPS is dropped entirely (`coordinates = null`). The /mapa page uses
 *     a separate raw-SQL pipeline that *coarsens* coordinates to ~110 m
 *     so anonymized markers can still appear on the public map at a fuzzy
 *     location — that path is intentional and unaffected by this function.
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
    coordinates: null,
  };
}

export function anonymizeMany<T extends FindLike>(
  finds: readonly T[],
): Array<SafeFind<T>["find"]> {
  return finds.map(anonymize);
}
