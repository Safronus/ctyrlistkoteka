import type { LokaceStavyPoznamky } from "@/lib/admin/jsonSchema";
import { parseRanges } from "@/lib/parseRanges";

export interface MultiLocationOffender {
  findId: number;
  /** All map-number keys this find id appears under in
   *  `lokace.<KEY>`. Length >= 2 — singletons are not offenders. */
  mapKeys: string[];
}

export interface DuplicatePoznamkaOffender {
  /** The repeated find-id key. */
  key: string;
  /** Number of times the key appears in the raw JSON's poznamky
   *  block — >= 2 by definition. */
  count: number;
}

export interface JsonInconsistencies {
  /** Find IDs that appear under more than one `lokace.<MAP_KEY>`
   *  range. */
  multipleLocations: MultiLocationOffender[];
  /** Find IDs whose key appears more than once in the raw JSON's
   *  `poznamky` block. The schema would normally collapse such
   *  duplicates silently (JSON.parse keeps the last value) — this
   *  check reads the raw text to catch them before that happens. */
  duplicatePoznamky: DuplicatePoznamkaOffender[];
}

/** Walks the parsed JSON + the raw source string to surface two
 *  kinds of inconsistency the editor's per-section schemas can't
 *  detect on their own:
 *
 *  - A find id under more than one `lokace.X` map key (a find can
 *    only physically belong to a single map at a time).
 *  - A find id key duplicated inside the `poznamky` object — JSON
 *    parsers collapse such duplicates to the last value, silently
 *    losing one of the notes. Catching them in the raw text lets
 *    the operator decide which to keep.
 *
 *  The `raw` argument is the unmodified file contents (NOT the
 *  re-emitted pretty-printed form), so the regex below sees keys
 *  exactly as the author wrote them. When raw is null (file
 *  missing or unreadable upstream) the duplicate-poznamky check
 *  silently skips — empty array. */
export function findInconsistencies(
  json: LokaceStavyPoznamky,
  raw: string | null,
): JsonInconsistencies {
  return {
    multipleLocations: findMultipleLocations(json),
    duplicatePoznamky: raw === null ? [] : findDuplicatePoznamky(raw),
  };
}

function findMultipleLocations(
  json: LokaceStavyPoznamky,
): MultiLocationOffender[] {
  // findId → set of map keys it appears under
  const byFindId = new Map<number, Set<string>>();
  for (const [mapKey, ranges] of Object.entries(json.lokace)) {
    const ids = parseRanges(ranges);
    for (const id of ids) {
      const set = byFindId.get(id) ?? new Set<string>();
      set.add(mapKey);
      byFindId.set(id, set);
    }
  }
  const out: MultiLocationOffender[] = [];
  for (const [findId, keys] of byFindId) {
    if (keys.size < 2) continue;
    out.push({
      findId,
      mapKeys: Array.from(keys).sort((a, b) => Number(a) - Number(b)),
    });
  }
  out.sort((a, b) => a.findId - b.findId);
  return out;
}

/** Detects duplicate keys inside the `poznamky` object by scanning
 *  the raw JSON text. JSON.parse silently keeps only the last value
 *  for a duplicate key, so the parsed object can't tell us they
 *  existed.
 *
 *  Heuristic: extract the `"poznamky"` object's text by counting
 *  braces, then for each `"<digits>"` key match inside that block
 *  count occurrences. Returns the keys appearing more than once.
 *  Returns [] when the poznamky block can't be located (unusual
 *  formatting, e.g. comments inserted manually). Better to under-
 *  report than to false-positive against a file the parser accepts. */
function findDuplicatePoznamky(raw: string): DuplicatePoznamkaOffender[] {
  // Find the start of the poznamky key. The schema requires it as a
  // top-level field, so a simple substring search after the opening
  // brace is reliable.
  const labelMatch = /"poznamky"\s*:\s*\{/.exec(raw);
  if (!labelMatch) return [];
  // labelMatch.index points at the first `"`; the opening `{` of the
  // poznamky object is at labelMatch.index + labelMatch[0].length - 1.
  let i = labelMatch.index + labelMatch[0].length - 1;
  // Scan brace-balanced until the matching `}` of the poznamky block.
  // Skip over string literals so braces inside note text don't throw
  // off the depth counter.
  let depth = 0;
  let blockStart = -1;
  let blockEnd = -1;
  for (; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      // Walk to the closing quote, accounting for escapes. We don't
      // care about the contents, only finding the close.
      i++;
      while (i < raw.length && raw[i] !== '"') {
        if (raw[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (ch === "{") {
      if (depth === 0) blockStart = i + 1;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        blockEnd = i;
        break;
      }
    }
  }
  if (blockStart === -1 || blockEnd === -1) return [];
  const block = raw.slice(blockStart, blockEnd);

  // Count digit-only keys. Keys appear as `"<digits>"\s*:`. The regex
  // anchors on the surrounding quote+colon shape so we don't match
  // digits inside note text.
  const keyCounts = new Map<string, number>();
  const re = /"(\d+)"\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const key = m[1]!;
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  const out: DuplicatePoznamkaOffender[] = [];
  for (const [key, count] of keyCounts) {
    if (count > 1) out.push({ key, count });
  }
  out.sort((a, b) => Number(a.key) - Number(b.key));
  return out;
}
