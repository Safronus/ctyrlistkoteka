/**
 * Expands an array of range specs into a sorted, unique list of integers.
 *
 * Spec grammar (per docs/filename-convention.md section D):
 *   "15"      → [15]
 *   "15-35"   → [15, 16, …, 35]
 *   ""        → [] (ignored)
 *
 * Throws on malformed specs so the sync fails loud rather than silently
 * dropping data.
 */
export function parseRanges(specs: readonly string[]): number[] {
  const out = new Set<number>();

  for (const raw of specs) {
    const s = raw.trim();
    if (!s) continue;

    const range = /^(\d+)-(\d+)$/.exec(s);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a > b) {
        throw new Error(`Invalid range: "${s}" (start > end)`);
      }
      for (let i = a; i <= b; i++) out.add(i);
      continue;
    }

    if (/^\d+$/.test(s)) {
      out.add(Number(s));
      continue;
    }

    throw new Error(`Invalid range spec: "${s}"`);
  }

  return [...out].sort((a, b) => a - b);
}
