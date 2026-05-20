/**
 * Maps the raw `category` / `kind` strings carried in
 * `clover-texts.json` onto i18n keys in the `CloverFacts` namespace.
 * Lives in its own module so server components (which compute
 * `kindLabel` at SSR time) and client components (which compute it
 * inside the rotator) can share the lookup without one crossing the
 * use-client boundary.
 *
 * Returning `null` for unknown values lets callers fall back to the
 * raw string verbatim — useful when a future batch adds a category
 * before the message bundle catches up; the UI keeps rendering
 * rather than crashing on a missing-key.
 */

/** Closed set of valid `category` values. Exported as a tuple so the
 *  admin editor dropdown and the Zod validator share a single source
 *  of truth.
 *
 *  Adding a new category here requires:
 *    1. `CATEGORY_KEYS` mapping below (CS string → i18n key).
 *    2. `catX` entry in messages/cs.json + messages/en.json.
 *    3. (Optional) update of any docs that enumerate categories. */
export const CLOVER_CATEGORIES = [
  "botany",
  "culture",
  "folklore",
  "history",
  "literature",
  "mythology",
  "poetry",
  "records",
  "science",
  "trivia",
] as const;

export type CloverCategory = (typeof CLOVER_CATEGORIES)[number];

/** Source-type badge variant rendered next to the title for
 *  non-author entries. */
export const CLOVER_SOURCE_TYPES = ["fact", "lore", "creative"] as const;

/** Vibe overrides — only meaningful on author entries; ignored
 *  otherwise. */
export const CLOVER_VIBES = ["happy", "demonic"] as const;

/** Known CS `kind` strings used for author entries. Free-text in the
 *  data (admin can extend), but the listed values are the ones the
 *  i18n mapper recognises today. Editor uses them as a datalist
 *  suggestion rather than a hard whitelist. */
export const CLOVER_KINDS_KNOWN = [
  "Rada autora",
  "Fakt o autorovi",
  "Fakt autora",
  "Hláška autora",
  "Záhadný nález",
  "Báseň autora",
] as const;

const CATEGORY_KEYS: Record<
  string,
  | "catBotany"
  | "catCulture"
  | "catFolklore"
  | "catHistory"
  | "catLiterature"
  | "catMythology"
  | "catPoetry"
  | "catRecords"
  | "catScience"
  | "catTrivia"
> = {
  botany: "catBotany",
  culture: "catCulture",
  folklore: "catFolklore",
  history: "catHistory",
  literature: "catLiterature",
  mythology: "catMythology",
  poetry: "catPoetry",
  records: "catRecords",
  science: "catScience",
  trivia: "catTrivia",
};

export function cloverCategoryKey(
  category: string,
): keyof typeof CATEGORY_KEYS extends string
  ? (typeof CATEGORY_KEYS)[keyof typeof CATEGORY_KEYS] | null
  : never {
  return CATEGORY_KEYS[category] ?? null;
}

const KIND_KEYS: Record<
  string,
  | "kindAuthorAdvice"
  | "kindAuthorFactAbout"
  | "kindAuthorFact"
  | "kindAuthorQuip"
  | "kindMysteriousFind"
  | "kindAuthorPoem"
> = {
  "Rada autora": "kindAuthorAdvice",
  "Fakt o autorovi": "kindAuthorFactAbout",
  "Fakt autora": "kindAuthorFact",
  "Hláška autora": "kindAuthorQuip",
  "Záhadný nález": "kindMysteriousFind",
  "Báseň autora": "kindAuthorPoem",
};

export function cloverKindKey(
  kind: string,
): (typeof KIND_KEYS)[keyof typeof KIND_KEYS] | null {
  return KIND_KEYS[kind] ?? null;
}
