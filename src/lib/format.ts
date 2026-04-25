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
