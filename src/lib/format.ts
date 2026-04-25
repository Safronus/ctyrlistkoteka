/**
 * Czech-language formatting helpers. Kept small and dependency-free.
 */

export function formatDateCs(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatShortDateCs(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("cs-CZ", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(date);
}

/**
 * Compact datetime ("po 12. 5. 2023 14:23:45") for cramped layouts like
 * the grid card. Short weekday keeps the column from blowing out, but
 * the day-of-week is still visible at a glance.
 */
export function formatShortDateTimeCs(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("cs-CZ", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

/**
 * Long Czech date with weekday name and full wall-clock time, e.g.
 * "pondělí 12. května 2018, 14:23:45". Used on the find detail page,
 * the location detail panel, and the sbirka list rows where the EXIF
 * capture time matters and there's room for the long form.
 */
export function formatDateTimeCs(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
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
 * meaningful unit and shows the next one too when it's non-zero, so the
 * result reads naturally:
 *   "před 2 lety a 3 měsíci"
 *   "před 5 měsíci a 12 dny"
 *   "před 4 dny a 7 hodinami"
 *   "před 3 hodinami a 12 minutami"
 *   "před chvílí"
 * Returns "—" for null/future.
 */
export function formatTimeSinceCs(date: Date | null | undefined): string {
  if (!date) return "—";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "—";

  const { years, months, days } = calendarDiff(date, now);

  const yearsStr = (n: number) =>
    `${n} ${pluralCs(n, ["rokem", "lety", "lety"])}`;
  const monthsStr = (n: number) =>
    `${n} ${pluralCs(n, ["měsícem", "měsíci", "měsíci"])}`;
  const daysStr = (n: number) =>
    `${n} ${pluralCs(n, ["dnem", "dny", "dny"])}`;
  const hoursStr = (n: number) =>
    `${n} ${pluralCs(n, ["hodinou", "hodinami", "hodinami"])}`;
  const minutesStr = (n: number) =>
    `${n} ${pluralCs(n, ["minutou", "minutami", "minutami"])}`;

  if (years > 0) {
    return months > 0
      ? `před ${yearsStr(years)} a ${monthsStr(months)}`
      : `před ${yearsStr(years)}`;
  }
  if (months > 0) {
    return days > 0
      ? `před ${monthsStr(months)} a ${daysStr(days)}`
      : `před ${monthsStr(months)}`;
  }
  if (days > 0) {
    // Hours-of-day for the open trailing window. floor(diffMs / day)
    // matches `days` here because no month/year boundary was crossed.
    const restMs = diffMs - days * 86_400_000;
    const hours = Math.max(0, Math.floor(restMs / 3_600_000));
    return hours > 0
      ? `před ${daysStr(days)} a ${hoursStr(hours)}`
      : `před ${daysStr(days)}`;
  }
  const totalHours = Math.floor(diffMs / 3_600_000);
  if (totalHours > 0) {
    const restMs = diffMs - totalHours * 3_600_000;
    const minutes = Math.floor(restMs / 60_000);
    return minutes > 0
      ? `před ${hoursStr(totalHours)} a ${minutesStr(minutes)}`
      : `před ${hoursStr(totalHours)}`;
  }
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "před chvílí";
  return `před ${minutesStr(minutes)}`;
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
