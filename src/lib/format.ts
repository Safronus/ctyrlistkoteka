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
 * Czech-style "how much time has passed since" string. Picks the largest
 * meaningful unit (years, months, days, hours, minutes) and shows the
 * next one too when it's non-zero, so the result reads naturally:
 *   "před 2 lety a 3 měsíci", "před 5 měsíci a 12 dny", "před 4 dny",
 *   "před 3 hodinami", "před chvílí". Returns "—" for null/future.
 */
export function formatTimeSinceCs(date: Date | null | undefined): string {
  if (!date) return "—";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "—";

  const { years, months, days } = calendarDiff(date, now);

  if (years === 0 && months === 0 && days === 0) {
    const hours = Math.floor(diffMs / 3_600_000);
    if (hours < 1) {
      const minutes = Math.floor(diffMs / 60_000);
      if (minutes < 1) return "před chvílí";
      return `před ${minutes} ${pluralCs(minutes, ["minutou", "minutami", "minutami"])}`;
    }
    return `před ${hours} ${pluralCs(hours, ["hodinou", "hodinami", "hodinami"])}`;
  }
  if (years === 0 && months === 0) {
    return `před ${days} ${pluralCs(days, ["dnem", "dny", "dny"])}`;
  }
  if (years === 0) {
    const m = `${months} ${pluralCs(months, ["měsícem", "měsíci", "měsíci"])}`;
    return days > 0
      ? `před ${m} a ${days} ${pluralCs(days, ["dnem", "dny", "dny"])}`
      : `před ${m}`;
  }
  const y = `${years} ${pluralCs(years, ["rokem", "lety", "lety"])}`;
  if (months > 0) {
    return `před ${y} a ${months} ${pluralCs(months, ["měsícem", "měsíci", "měsíci"])}`;
  }
  return `před ${y}`;
}

function calendarDiff(
  from: Date,
  to: Date,
): { years: number; months: number; days: number } {
  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  let days = to.getDate() - from.getDate();
  if (days < 0) {
    months -= 1;
    // Borrow the day count of the month preceding `to`.
    days += new Date(to.getFullYear(), to.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
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

/**
 * Czech-formatted area string. Picks a unit that keeps the number
 * readable: m² for small plots, ha for fields, km² for the rare big
 * polygon. Two decimal places for the larger units, integer for m².
 */
export function formatAreaM2(m2: number): string {
  if (m2 >= 1_000_000) {
    const km2 = m2 / 1_000_000;
    return `${new Intl.NumberFormat("cs-CZ", {
      maximumFractionDigits: 2,
    }).format(km2)} km²`;
  }
  if (m2 >= 10_000) {
    const ha = m2 / 10_000;
    return `${new Intl.NumberFormat("cs-CZ", {
      maximumFractionDigits: 2,
    }).format(ha)} ha`;
  }
  return `${new Intl.NumberFormat("cs-CZ", {
    maximumFractionDigits: 0,
  }).format(Math.round(m2))} m²`;
}
