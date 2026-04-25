/**
 * Czech-language formatting helpers. Kept small and dependency-free.
 */

export function formatDateCs(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatShortDateCs(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(date);
}

/**
 * Compact datetime ("12. 5. 2023 14:23:45") for cramped layouts like
 * the grid card. Mirrors formatDateTimeCs but uses numeric month and
 * drops the "v" word so the whole string fits in a tile column.
 */
export function formatShortDateTimeCs(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

/**
 * Long Czech date with full wall-clock time. Used on the find detail page
 * where the EXIF capture time matters. Returns "—" for missing inputs.
 */
export function formatDateTimeCs(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

/**
 * Czech pluralization — 1 / 2..4 / 5+ / 0.
 * Usage: pluralCs(n, ["nález", "nálezy", "nálezů"])
 */
export function pluralCs(
  n: number,
  forms: readonly [string, string, string],
): string {
  if (n === 1) return forms[0];
  if (n >= 2 && n <= 4) return forms[1];
  return forms[2];
}

export function formatCount(
  n: number,
  forms: readonly [string, string, string],
): string {
  return `${new Intl.NumberFormat("cs-CZ").format(n)} ${pluralCs(n, forms)}`;
}

export const FINDS = ["nález", "nálezy", "nálezů"] as const;
export const LOCATIONS = ["lokalita", "lokality", "lokalit"] as const;
export const YEARS = ["rok", "roky", "let"] as const;

/**
 * Five-digit location identifier matching the user's MAP_ID convention,
 * e.g. 1 → "#00001". Used in the find detail panel and the list view's
 * title row.
 */
export function formatLocationId(id: number): string {
  return `#${String(id).padStart(5, "0")}`;
}
