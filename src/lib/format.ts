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
 * Czech-style "how much time has passed since" string. Joins every
 * non-zero calendar unit down to hours so longer gaps still get the
 * fine-grain context the date alone hides:
 *   "před 4 lety, 9 měsíci, 27 dny a 5 hodinami"
 *   "před 5 měsíci, 12 dny a 3 hodinami"
 *   "před 4 dny a 7 hodinami"
 *   "před 3 hodinami a 12 minutami"
 *   "před 12 minutami"
 *   "před chvílí"
 * Returns "—" for null/future.
 */
export function formatTimeSinceCs(date: Date | null | undefined): string {
  if (!date) return "—";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "—";

  const { years, months, days, hours, minutes } = preciseCalendarDiff(
    date,
    now,
  );

  const parts: string[] = [];
  if (years > 0)
    parts.push(`${years} ${pluralCs(years, ["rokem", "lety", "lety"])}`);
  if (months > 0)
    parts.push(`${months} ${pluralCs(months, ["měsícem", "měsíci", "měsíci"])}`);
  if (days > 0)
    parts.push(`${days} ${pluralCs(days, ["dnem", "dny", "dny"])}`);
  if (hours > 0)
    parts.push(`${hours} ${pluralCs(hours, ["hodinou", "hodinami", "hodinami"])}`);

  // When the gap is < 1 hour, fall through to minutes (or "před chvílí").
  if (parts.length === 0) {
    if (minutes < 1) return "před chvílí";
    return `před ${minutes} ${pluralCs(minutes, ["minutou", "minutami", "minutami"])}`;
  }

  return `před ${joinCs(parts)}`;
}

/**
 * Joins string parts the Czech way: "A", "A a B", "A, B a C". Default
 * (no Oxford comma) — matches everyday Czech style.
 */
function joinCs(parts: readonly string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} a ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} a ${parts[parts.length - 1]}`;
}

/**
 * Five-component calendar diff between two Dates with proper
 * borrow-chain (minutes → hours → days → months → years). Only goes
 * down to minutes — sub-minute diffs are reported as "před chvílí".
 */
function preciseCalendarDiff(
  from: Date,
  to: Date,
): {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
} {
  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  let days = to.getDate() - from.getDate();
  let hours = to.getHours() - from.getHours();
  let minutes = to.getMinutes() - from.getMinutes();

  if (minutes < 0) {
    hours -= 1;
    minutes += 60;
  }
  if (hours < 0) {
    days -= 1;
    hours += 24;
  }
  if (days < 0) {
    months -= 1;
    days += new Date(to.getFullYear(), to.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days, hours, minutes };
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
/**
 * Distance formatter used in the find list, detail page, and the
 * "farthest find" card on /statistiky. Picks the friendliest unit
 * for the magnitude:
 *   < 1 m      → centimetres (rounded)
 *   < 1 km     → metres (rounded)
 *   < 100 km   → kilometres with one decimal — keeps 12.3 km legible
 *   ≥ 100 km   → integer kilometres; decimals just add noise at that scale
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "";
  if (meters < 1) {
    return `${new Intl.NumberFormat("cs-CZ").format(
      Math.round(meters * 100),
    )} cm`;
  }
  if (meters < 1000) {
    return `${new Intl.NumberFormat("cs-CZ").format(Math.round(meters))} m`;
  }
  const km = meters / 1000;
  if (km < 100) {
    return `${new Intl.NumberFormat("cs-CZ", {
      maximumFractionDigits: 1,
    }).format(km)} km`;
  }
  return `${new Intl.NumberFormat("cs-CZ", {
    maximumFractionDigits: 0,
  }).format(km)} km`;
}

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

/** Formats a clovers/area density as a per-100 m² figure. We picked the
 *  100 m² unit so the typical landscape (areas in 100s–1000s of m² with
 *  10s–100s of finds) lands on a humanly-readable 1–100ish range —
 *  per-m² values would be 0.0X with little visual contrast, per-ha
 *  values would compress smaller plots into the same digit. Returns
 *  e.g. "12,3 / 100 m²". */
export function formatDensityPer100m2(density: number): string {
  const fractionDigits = density >= 10 ? 1 : 2;
  return `${new Intl.NumberFormat("cs-CZ", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(density)} / 100 m²`;
}
