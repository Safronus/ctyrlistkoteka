import { compactToRanges, parseRanges } from "@/lib/parseRanges";
import {
  STAVY_KEYS,
  type LokaceStavyPoznamky,
  type LokaceStavyPoznamkyMergeInput,
} from "@/lib/admin/jsonSchema";

/**
 * Pure, I/O-free merge logic for `LokaceStavyPoznamky.json`, shared between:
 *   - the per-section + whole-file merge server actions (the JSON editor), and
 *   - the package-import analyze step (dry-run preview) + commit.
 *
 * Kept in `src/lib` (not next to the "use server" actions) so both an action
 * and a plain lib can import it, and so a client component can `import type`
 * the diff shapes from here — a "use server" module can't be imported from a
 * client bundle even for a type.
 */

// ── Range-array union with diff tracking ───────────────────────────────────

export interface RangeMergeResult {
  /** Compacted, sorted, range-merged result. */
  merged: string[];
  /** IDs newly added (not in existing). */
  added: number[];
  /** IDs already covered by existing — the "duplicates" skipped on merge. */
  alreadyPresent: number[];
}

/** Range-array union with diff tracking. Same compaction rules as
 *  `parseRanges` + `compactToRanges`, plus a split of incoming IDs into
 *  "newly added" vs "already present". */
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

// ── Whole-file merge (all four sections at once) ───────────────────────────

export interface MergeConflict {
  /** Human-readable JSON pointer (`poznamky["12345"]`). */
  path: string;
  existing: string;
  incoming: string;
}

/** Per-section diff after a whole-file merge. Each section is populated
 *  independently so the UI can render four small "rolled-up" cards. */
export interface WholeFileMergeSectionDiff {
  /** IDs newly added to this section's range fields. For poznamky this stays
   *  empty — poznamky uses key-level additions in `addedKeys`. */
  addedIds: number[];
  /** IDs already present in this section's existing ranges (no-op). */
  alreadyPresentIds: number[];
  /** Keys newly added — `poznamky` (find id keys) and `lokace` (map keys). */
  addedKeys: string[];
  /** Keys already present with the same value. */
  alreadyPresentKeys: string[];
}

export interface WholeFileMergeSections {
  anonymizace: WholeFileMergeSectionDiff;
  stavy: WholeFileMergeSectionDiff;
  poznamky: WholeFileMergeSectionDiff;
  lokace: WholeFileMergeSectionDiff;
}

export interface WholeFileMergeComputation {
  /** Fully merged object (existing ∪ incoming). Validate against the strict
   *  schema before writing. */
  merged: LokaceStavyPoznamky;
  sections: WholeFileMergeSections;
  /** poznamky keys present on both sides with diverging text — a real merge
   *  aborts when this is non-empty. */
  conflicts: MergeConflict[];
  /** Total net additions across all sections (0 ⇒ nothing new). */
  totalChanges: number;
}

export function emptyDiff(): WholeFileMergeSectionDiff {
  return {
    addedIds: [],
    alreadyPresentIds: [],
    addedKeys: [],
    alreadyPresentKeys: [],
  };
}

function uniqueSortAsc(arr: number[]): number[] {
  return [...new Set(arr)].sort((a, b) => a - b);
}

/**
 * Additive union of an entire (partial) LokaceStavyPoznamky shape into an
 * existing one. Range fields union (with per-id added/already-present diff);
 * poznamky keys union with conflict detection. Pure — no reads, no writes.
 * The caller validates `merged` against the strict schema before persisting.
 */
export function computeWholeFileMerge(
  incoming: LokaceStavyPoznamkyMergeInput,
  existing: LokaceStavyPoznamkyMergeInput,
): WholeFileMergeComputation {
  const merged: LokaceStavyPoznamky = {
    anonymizace: {
      ANONYMIZOVANE: [...(existing.anonymizace?.ANONYMIZOVANE ?? [])],
    },
    stavy: { ...(existing.stavy ?? {}) } as LokaceStavyPoznamky["stavy"],
    poznamky: { ...(existing.poznamky ?? {}) },
    lokace: { ...(existing.lokace ?? {}) },
  };

  const sections: WholeFileMergeSections = {
    anonymizace: emptyDiff(),
    stavy: emptyDiff(),
    poznamky: emptyDiff(),
    lokace: emptyDiff(),
  };

  // ── anonymizace ────────────────────────────────────────────────
  {
    const r = mergeRanges(
      merged.anonymizace.ANONYMIZOVANE,
      incoming.anonymizace?.ANONYMIZOVANE ?? [],
    );
    merged.anonymizace = { ANONYMIZOVANE: r.merged };
    sections.anonymizace.addedIds = r.added;
    sections.anonymizace.alreadyPresentIds = r.alreadyPresent;
  }

  // ── stavy.<KEY> per key ─────────────────────────────────────────
  const incomingStavy = incoming.stavy as
    | Record<string, string[] | undefined>
    | undefined;
  for (const key of STAVY_KEYS) {
    const incomingArr = incomingStavy?.[key];
    if (!incomingArr || incomingArr.length === 0) continue;
    const existingArr =
      (merged.stavy[key as keyof typeof merged.stavy] as string[] | undefined) ??
      [];
    const r = mergeRanges(existingArr, incomingArr);
    (merged.stavy as Record<string, string[]>)[key] = r.merged;
    sections.stavy.addedIds.push(...r.added);
    sections.stavy.alreadyPresentIds.push(...r.alreadyPresent);
  }
  sections.stavy.addedIds = uniqueSortAsc(sections.stavy.addedIds);
  sections.stavy.alreadyPresentIds = uniqueSortAsc(
    sections.stavy.alreadyPresentIds,
  );

  // ── poznamky ───────────────────────────────────────────────────
  const conflicts: MergeConflict[] = [];
  for (const [key, value] of Object.entries(incoming.poznamky ?? {})) {
    if (key in merged.poznamky) {
      const current = merged.poznamky[key]!;
      if (current === value) {
        sections.poznamky.alreadyPresentKeys.push(key);
      } else {
        conflicts.push({
          path: `poznamky["${key}"]`,
          existing: current,
          incoming: value,
        });
      }
    } else {
      merged.poznamky[key] = value;
      sections.poznamky.addedKeys.push(key);
    }
  }

  // ── lokace.<CODE> per code ─────────────────────────────────────
  for (const [code, ranges] of Object.entries(incoming.lokace ?? {})) {
    const isNewCode = !(code in merged.lokace);
    const existingArr = merged.lokace[code] ?? [];
    const r = mergeRanges(existingArr, ranges);
    merged.lokace[code] = r.merged;
    sections.lokace.addedIds.push(...r.added);
    sections.lokace.alreadyPresentIds.push(...r.alreadyPresent);
    if (isNewCode) sections.lokace.addedKeys.push(code);
  }
  sections.lokace.addedIds = uniqueSortAsc(sections.lokace.addedIds);
  sections.lokace.alreadyPresentIds = uniqueSortAsc(
    sections.lokace.alreadyPresentIds,
  );

  const totalChanges =
    sections.anonymizace.addedIds.length +
    sections.stavy.addedIds.length +
    sections.poznamky.addedKeys.length +
    sections.lokace.addedIds.length +
    sections.lokace.addedKeys.length;

  return { merged, sections, conflicts, totalChanges };
}
