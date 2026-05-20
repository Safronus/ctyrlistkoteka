/**
 * Clover-text type definitions + the pure `localizedClover()` helper.
 *
 * This module is **client-safe** (no Node-only imports) so the
 * homepage's client-side rotator (`CloverFactCard`) can import the
 * types and helper without dragging `node:fs` into the client bundle.
 *
 * The runtime fs loader lives in the sibling module
 * `src/lib/cloverTextsServer.ts`. Server components import the loader
 * functions there, then pass plain JSON shapes (texts + translations)
 * down to the client component as props.
 */

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

export interface CloverEnEntry {
  title: string;
  text: string;
  /** Author entries carry an EN `kind` translation here so the kind
   *  label can be swapped per-id rather than via the i18n KIND_KEYS
   *  map (which only maps a fixed set of CS strings — fine for the
   *  current data, but the per-id field future-proofs against new
   *  one-off kinds the author might add). */
  kind?: string;
}

/**
 * Returns a localised view of a clover entry. For `cs` (or any locale
 * we don't carry translations for) the original is returned untouched;
 * for `en` we look up the id in the sidecar file and substitute
 * `title`, `text`, and (if present) `kind`. Falls back to the CS source
 * when the id has no translation yet — the UI keeps rendering rather
 * than crashing on a missing entry.
 *
 * The second argument is the already-loaded translations map, passed
 * in by callers so we don't trigger a fresh fs read for every render.
 * Server components fetch the map once and reuse it across the page
 * tree; client components receive it as a prop.
 */
export function localizedClover(
  text: CloverText,
  locale: string,
  translations: Readonly<Record<string, CloverEnEntry>>,
): CloverText {
  if (locale === "cs") return text;
  const tr = translations[String(text.id)];
  if (!tr) return text;
  return {
    ...text,
    title: tr.title,
    text: tr.text,
    ...(tr.kind ? { kind: tr.kind } : {}),
  };
}
