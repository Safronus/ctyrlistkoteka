/**
 * Bundled clover-texts loader. The texts are shuffled once (offline,
 * via `scripts/shuffle-clover-texts.ts`) into `src/data/`; this module
 * just types the import for callers. The on-disk order is the canonical
 * sequence — every numeric `id` keeps its original meaning, but the
 * home-page rotator iterates by *array index*, not by id.
 */

import shuffled from "@/data/clover-texts.shuffled.json";

export type CloverTextSource = "fact" | "lore" | "creative";

export type CloverTextVibe = "happy" | "demonic";

export interface CloverText {
  id: number;
  category: string;
  title: string;
  text: string;
  source_type: CloverTextSource;
  /** When true the entry is authored by the project owner; the home
   *  card swaps to a clover-themed paper variant with a BONUS badge.
   *  Optional — most entries are general lore/facts and omit it. */
  author?: boolean;
  /** Visible label for author entries (e.g. "Rada autora", "Báseň
   *  autora"). Ignored when `author` is falsy. */
  kind?: string;
  /** Optional theme override beyond the default "author" emerald
   *  treatment. "happy" → festive sun-tinted gradient (poem #111).
   *  "demonic" → dark/red gradient with hellish marker (#666). */
  vibe?: CloverTextVibe;
  /** When set, the whole paper card becomes a link to this URL.
   *  #666 uses this to deep-link to the matching find detail. */
  link?: string;
}

export const CLOVER_TEXTS: ReadonlyArray<CloverText> =
  shuffled.texts as ReadonlyArray<CloverText>;
