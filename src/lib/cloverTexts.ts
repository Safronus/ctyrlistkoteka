/**
 * Bundled clover-texts loader. The texts are shuffled once (offline,
 * via `scripts/shuffle-clover-texts.ts`) into `src/data/`; this module
 * just types the import for callers. The on-disk order is the canonical
 * sequence — every numeric `id` keeps its original meaning, but the
 * home-page rotator iterates by *array index*, not by id.
 */

import shuffled from "@/data/clover-texts.shuffled.json";

export type CloverTextSource = "fact" | "lore" | "creative";

export interface CloverText {
  id: number;
  category: string;
  title: string;
  text: string;
  source_type: CloverTextSource;
}

export const CLOVER_TEXTS: ReadonlyArray<CloverText> =
  shuffled.texts as ReadonlyArray<CloverText>;
