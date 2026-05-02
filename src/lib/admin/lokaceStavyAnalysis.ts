import { parseRanges } from "@/lib/parseRanges";
import type { LokaceStavyPoznamky } from "@/lib/admin/jsonSchema";

/** Snapshot of derived facts about a parsed LokaceStavyPoznamky.json.
 *
 *  Computed once on the server and shipped to the preview client
 *  component as a plain JSON object — Sets/Maps would need
 *  serialisation, so use Records/arrays everywhere.
 *
 *  Used both for the stats banner (high-level counts + anomalies)
 *  and the find-lookup widget (reverse maps find ID → settings). */
export interface LSPAnalysis {
  /** Distinct find IDs present in any `lokace` range. */
  findsInLokace: number;
  /** Per-key count of distinct find IDs in `stavy.<key>` ranges. */
  findsInStavy: Record<string, number>;
  /** Distinct find IDs in any `stavy.<key>`. */
  findsInAnyStavy: number;
  /** poznamky entries (count of keys). */
  notesCount: number;
  /** Distinct find IDs after expanding `anonymizace.ANONYMIZOVANE`. */
  anonymizovaneCount: number;

  /** Anomaly: IDs in stavy.DAROVANY without a matching poznamky entry.
   *  Capped to first 50 — the banner truncates with "+ N dalších". */
  donanyMissingNote: number[];
  donanyMissingNoteTotal: number;
  /** Anomaly: IDs that show up in any `stavy.<key>` but aren't in any
   *  `lokace.<key>` — sync.ts couldn't bind them to a location. */
  stavyMissingLokace: number[];
  stavyMissingLokaceTotal: number;

  // Reverse lookup helpers.
  /** findId → location key (the parent in `lokace`). */
  findToLokace: Record<number, string>;
  /** findId → list of state keys (DAROVANY, BEZFOTKY, …). */
  findToStavy: Record<number, string[]>;
  /** Sorted ascending list of anonymized find IDs. Used both for the
   *  banner count and the per-find lookup ("ANO/NE"). */
  anonymizovane: number[];
}

const ANOMALY_INLINE = 50;

function expandSafe(specs: readonly string[]): number[] {
  try {
    return parseRanges(specs);
  } catch {
    // The Zod schema already rejects malformed ranges before this
    // helper runs, but be defensive — a future schema relaxation
    // shouldn't crash the preview page.
    return [];
  }
}

export function analyzeLokaceStavyPoznamky(
  parsed: LokaceStavyPoznamky,
): LSPAnalysis {
  const findToLokace: Record<number, string> = {};
  const lokaceFindSet = new Set<number>();
  for (const [key, ranges] of Object.entries(parsed.lokace)) {
    for (const id of expandSafe(ranges)) {
      lokaceFindSet.add(id);
      // First-write-wins: a find shouldn't be in two locations, but
      // if the JSON has a typo we keep the earliest binding so the
      // lookup is deterministic.
      if (findToLokace[id] === undefined) findToLokace[id] = key;
    }
  }

  const findToStavy: Record<number, string[]> = {};
  const findsInStavy: Record<string, number> = {};
  const stavyFindSet = new Set<number>();
  for (const [key, ranges] of Object.entries(parsed.stavy)) {
    const ids = expandSafe(ranges);
    findsInStavy[key] = new Set(ids).size;
    for (const id of ids) {
      stavyFindSet.add(id);
      const arr = findToStavy[id] ?? [];
      if (!arr.includes(key)) arr.push(key);
      findToStavy[id] = arr;
    }
  }

  const anonymizovaneIds = expandSafe(parsed.anonymizace.ANONYMIZOVANE);
  const anonymizovane = [...new Set(anonymizovaneIds)].sort((a, b) => a - b);

  // Anomalies.
  const donanyMissingNoteAll: number[] = [];
  const donanyIds = expandSafe(parsed.stavy.DAROVANY ?? []);
  for (const id of donanyIds) {
    if (parsed.poznamky[String(id)] === undefined) {
      donanyMissingNoteAll.push(id);
    }
  }

  const stavyMissingLokaceAll: number[] = [];
  for (const id of stavyFindSet) {
    if (!lokaceFindSet.has(id)) stavyMissingLokaceAll.push(id);
  }
  stavyMissingLokaceAll.sort((a, b) => a - b);

  return {
    findsInLokace: lokaceFindSet.size,
    findsInStavy,
    findsInAnyStavy: stavyFindSet.size,
    notesCount: Object.keys(parsed.poznamky).length,
    anonymizovaneCount: anonymizovane.length,

    donanyMissingNote: donanyMissingNoteAll.slice(0, ANOMALY_INLINE),
    donanyMissingNoteTotal: donanyMissingNoteAll.length,
    stavyMissingLokace: stavyMissingLokaceAll.slice(0, ANOMALY_INLINE),
    stavyMissingLokaceTotal: stavyMissingLokaceAll.length,

    findToLokace,
    findToStavy,
    anonymizovane,
  };
}
