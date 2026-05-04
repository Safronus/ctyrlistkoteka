/**
 * Maps the raw `category` / `kind` strings carried in
 * `clover-texts.shuffled.json` onto i18n keys in the `CloverFacts`
 * namespace. Lives in its own module so server components (which
 * compute `kindLabel` at SSR time) and client components (which
 * compute it inside the rotator) can share the lookup without one
 * crossing the use-client boundary.
 *
 * Returning `null` for unknown values lets callers fall back to the
 * raw string verbatim — useful when a future shuffled batch adds a
 * category before the message bundle catches up; the UI keeps
 * rendering rather than crashing on a missing-key.
 */

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
