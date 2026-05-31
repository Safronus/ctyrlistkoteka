import { compactToRanges, parseRanges } from "@/lib/parseRanges";

/** Pure range-array helpers shared between the per-section merge
 *  action and the whole-file merge action.
 *
 *  Lives in its own module (NOT in `merge-action.ts`) on purpose:
 *  Next.js enforces that every export from a `"use server"` file is
 *  an async function. Exporting this sync helper from the action
 *  module compiles locally but fails the production build with
 *  `Server Actions must be async functions`. Keeping it here means
 *  both action files can import the same logic without that
 *  constraint. */

export interface RangeMergeResult {
  /** Compacted, sorted, range-merged result. */
  merged: string[];
  /** IDs newly added (not in existing). */
  added: number[];
  /** IDs already covered by existing — these are the "duplicates"
   *  the user was warned would be skipped. */
  alreadyPresent: number[];
}

/** Range-array union with diff tracking. Same compaction rules as
 *  `parseRanges` + `compactToRanges`, plus a split of incoming IDs
 *  into "newly added" vs "already present" that drives the merge
 *  result panel. */
export function mergeRanges(
  existing: readonly string[],
  incoming: readonly string[],
): RangeMergeResult {
  const existingIds = new Set(parseRanges(existing));
  const incomingIds = parseRanges(incoming);
  const added: number[] = [];
  const alreadyPresent: number[] = [];
  for (const id of incomingIds) {
    if (existingIds.has(id)) {
      alreadyPresent.push(id);
    } else {
      existingIds.add(id);
      added.push(id);
    }
  }
  return {
    merged: compactToRanges([...existingIds]),
    added: [...new Set(added)].sort((a, b) => a - b),
    alreadyPresent: [...new Set(alreadyPresent)].sort((a, b) => a - b),
  };
}
