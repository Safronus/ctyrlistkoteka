/**
 * Central anonymization boundary. **All find data sent to the UI must go
 * through this function** — reading `find.notes` or `find.coordinates`
 * directly in components, API routes, or meta tags would leak data.
 *
 * Rules (per CLAUDE.md §6):
 *   • Notes are nulled for anonymized finds.
 *   • GPS is HIDDEN entirely (`coordinates = null`) — never coarsened.
 *     The /mapa page uses a separate raw-SQL pipeline (src/lib/queries/
 *     map.ts) that likewise EXCLUDES anonymized finds and anonymized
 *     locations outright (`WHERE f.is_anonymized = false`); they are never
 *     painted at all. (Do NOT "restore" fuzzy anonymized markers — an
 *     approximate dot is still a location disclosure §6 forbids. Its
 *     `ROUND(…, 6)` on coords is ~0.11 m payload trimming for the finds it
 *     DOES paint, i.e. non-anonymized ones — not a privacy step.)
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
    /** True if sensitive data was hidden (notes + coordinates nulled).
     *  Components use this to decide whether to render markers like
     *  "Anonymized find". */
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
