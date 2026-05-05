/**
 * Bundled clover-texts loader. The texts are shuffled once (offline,
 * via `scripts/shuffle-clover-texts.ts`) into `src/data/`; this module
 * just types the import for callers. The on-disk order is the canonical
 * sequence — every numeric `id` keeps its original meaning, but the
 * home-page rotator iterates by *array index*, not by id.
 *
 * EN translations live in a parallel sidecar file
 * (`src/data/clover-texts.en.json`) keyed by the same numeric `id`.
 * `localizedClover(text, locale)` returns a CS or EN view of an entry
 * without touching the original (so the rotator's index/randomisation
 * stays locale-agnostic — same shuffle, same id sequence, just the
 * human-visible strings swap).
 */

import shuffled from "@/data/clover-texts.shuffled.json";
import enTranslations from "@/data/clover-texts.en.json";

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

interface CloverEnEntry {
  title: string;
  text: string;
  /** Author entries carry an EN `kind` translation here so the kind
   *  label can be swapped per-id rather than via the i18n KIND_KEYS
   *  map (which only maps a fixed set of CS strings — fine for the
   *  current data, but the per-id field future-proofs against new
   *  one-off kinds the author might add). */
  kind?: string;
}

const EN_TRANSLATIONS: Record<string, CloverEnEntry> =
  enTranslations.translations as Record<string, CloverEnEntry>;

/**
 * Returns a localised view of a clover entry. For `cs` (or any locale
 * we don't carry translations for) the original is returned untouched;
 * for `en` we look up the id in the sidecar file and substitute
 * `title`, `text`, and (if present) `kind`. Falls back to the CS source
 * when the id has no translation yet — the UI keeps rendering rather
 * than crashing on a missing entry.
 */
export function localizedClover(
  text: CloverText,
  locale: string,
): CloverText {
  if (locale === "cs") return text;
  const tr = EN_TRANSLATIONS[String(text.id)];
  if (!tr) return text;
  return {
    ...text,
    title: tr.title,
    text: tr.text,
    ...(tr.kind ? { kind: tr.kind } : {}),
  };
}
