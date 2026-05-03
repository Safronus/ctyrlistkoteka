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

/**
 * Inverse of parseRanges: collapses an integer list into a sorted,
 * compact range-string array. Duplicates are dropped.
 *
 *   [1, 2, 3, 5, 7, 8, 9] → ["1-3", "5", "7-9"]
 *   []                    → []
 *
 * Used by the admin "mark donated / unmark donated" actions to keep
 * `LokaceStavyPoznamky.json` `stavy.<KEY>` arrays sorted and merged
 * after every edit — without this the array would just grow with
 * appended singletons (e.g. ["13602-13603", …, "16945", "1"]).
 */
export function compactToRanges(ids: readonly number[]): string[] {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const out: string[] = [];
  let start = sorted[0]!;
  let end = start;
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (n === end + 1) {
      end = n;
    } else {
      out.push(start === end ? String(start) : `${start}-${end}`);
      start = n;
      end = n;
    }
  }
  out.push(start === end ? String(start) : `${start}-${end}`);
  return out;
}
