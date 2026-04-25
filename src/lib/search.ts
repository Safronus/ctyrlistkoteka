/**
 * Helpers for full-text search inputs that can also act as ID lookups.
 *
 * The user's IDs are integers but always *displayed* zero-padded to five
 * digits (#00001 .. #99999 — see `formatLocationId` / `formatFindId` in
 * `format.ts`). A search like "0001" or "#00001" must therefore resolve
 * to id=1, even though Prisma would reject those leading zeros as a
 * filter value. Centralising the parsing here keeps the three search
 * surfaces (/lokality, /sbirka, /mapa sidebar) consistent.
 */

/** Width of the zero-padded ID display, mirroring `formatLocationId`. */
const ID_PAD = 5;

export interface IdQuery {
  /** Parsed integer (leading zeros stripped). Useful for exact `id = N`
   *  matches in DB filters. */
  exactId: number;
  /** Original digit substring — kept verbatim so callers can match it
   *  against the padded form (`"0001"` → matches `00001`, `00010`-`00019`,
   *  `00100`-`00199`, etc.). */
  digits: string;
}

/**
 * Returns an ID interpretation of `q` when it looks like a numeric lookup
 * (optionally prefixed with `#`), null otherwise. Empty / non-digit input
 * yields null so callers can simply skip ID matching.
 */
export function parseIdQuery(q: string): IdQuery | null {
  const trimmed = q.trim().replace(/^#/, "");
  if (!/^\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return { exactId: n, digits: trimmed };
}

/**
 * Client-side helper: does the given numeric ID's padded form contain the
 * digit substring? E.g. id=1 → "00001" contains "0001" → true. Used by
 * in-memory list filters where matching just `exactId` would miss the
 * "shorter substring" cases the user expects.
 */
export function paddedIdMatches(id: number, digits: string): boolean {
  if (!digits) return false;
  return String(id).padStart(ID_PAD, "0").includes(digits);
}
