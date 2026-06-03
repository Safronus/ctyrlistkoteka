import { FIND_DEVIATION_RADIUS_M } from "@/lib/constants";

/**
 * Locale-aware formatting helpers.
 *
 * Most helpers take an optional `locale` parameter that defaults to
 * `"cs-CZ"` — this preserves every existing call site (no diffs needed
 * to keep Czech rendering) while letting i18n-aware callers pass
 * `"en-US"` (or `useLocale()` resolved to the BCP-47 form) for English
 * pages. The function names retain their "Cs" suffix for now to keep
 * the refactor diff small; rename can land in a follow-up if/when the
 * Czech-specific connotation feels misleading.
 *
 * Pluralization is handled differently — the legacy `pluralCs` /
 * `formatCount` helpers stay for Czech-only call sites, but page-level
 * UI on i18n-aware routes should prefer next-intl's
 * `t('key', {count})` ICU plural forms instead.
 */

/** BCP-47 tag → Intl-friendly locale. Maps next-intl's two-letter
 *  codes (`"cs"` / `"en"`) onto the regional variants `Intl` expects
 *  (`"cs-CZ"` / `"en-GB"`). The site is run from CZ; en-GB matches the
 *  metric units + DD/MM/YYYY ordering Czech readers' "English mode"
 *  expectations more closely than en-US (12 May 2018 vs May 12, 2018). */
function toIntlLocale(locale: string | undefined): string {
  if (!locale) return "cs-CZ";
  if (locale === "cs") return "cs-CZ";
  if (locale === "en") return "en-GB";
  return locale;
}

export function formatDateCs(
  date: Date | null | undefined,
  locale?: string,
): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatShortDateCs(
  date: Date | null | undefined,
  locale?: string,
): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
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
export function formatShortDateTimeCs(
  date: Date | null | undefined,
  locale?: string,
): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
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
 * Smallest useful datetime for mobile list rows ("21. 5. 2026 8:50") —
 * drops both the weekday and the seconds so the date fits inside the
 * ~140-px content column next to a 96-px thumbnail without overflowing
 * into the "show on map" rail. The desktop side of the same row keeps
 * `formatDateTimeCs` because there's room for the long form there.
 */
export function formatTinyDateTimeCs(
  date: Date | null | undefined,
  locale?: string,
): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Long Czech date with weekday name and full wall-clock time, e.g.
 * "pondělí 12. května 2018, 14:23:45". Used on the find detail page,
 * the location detail panel, and the sbirka list rows where the EXIF
 * capture time matters and there's room for the long form.
 */
export function formatDateTimeCs(
  date: Date | null | undefined,
  locale?: string,
): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
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
 * Locale-aware "how much time has passed since" string. Joins every
 * non-zero calendar unit down to hours so longer gaps still get the
 * fine-grain context the date alone hides. The caller resolves a
 * `TimeSince`-namespace translator (server-side via `getTranslations`
 * or client-side via `useTranslations`) and hands it down — keeps the
 * Intl logic locale-blind here while letting both Czech instrumental
 * cases and English "X ago" templates stay in the message bundle.
 *
 * CZ examples:
 *   "před 4 lety, 9 měsíci, 27 dny a 5 hodinami"
 *   "před chvílí"
 * EN examples:
 *   "4 years, 9 months, 27 days and 5 hours ago"
 *   "just now"
 */
type TimeSinceTranslator = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string;

export function formatTimeSinceCs(
  date: Date | null | undefined,
  t?: TimeSinceTranslator,
): string {
  if (!date) return "—";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "—";

  const { years, months, days, hours, minutes } = preciseCalendarDiff(
    date,
    now,
  );

  // Fallback to the legacy hardcoded Czech path when no translator was
  // passed — keeps existing CZ-only call sites working unchanged.
  if (!t) {
    const parts: string[] = [];
    if (years > 0)
      parts.push(`${years} ${pluralCs(years, ["rokem", "lety", "lety"])}`);
    if (months > 0)
      parts.push(`${months} ${pluralCs(months, ["měsícem", "měsíci", "měsíci"])}`);
    if (days > 0)
      parts.push(`${days} ${pluralCs(days, ["dnem", "dny", "dny"])}`);
    if (hours > 0)
      parts.push(
        `${hours} ${pluralCs(hours, ["hodinou", "hodinami", "hodinami"])}`,
      );
    if (parts.length === 0) {
      if (minutes < 1) return "před chvílí";
      return `před ${minutes} ${pluralCs(minutes, ["minutou", "minutami", "minutami"])}`;
    }
    return `před ${joinCs(parts, "a")}`;
  }

  const parts: string[] = [];
  if (years > 0) parts.push(t("years", { count: years }));
  if (months > 0) parts.push(t("months", { count: months }));
  if (days > 0) parts.push(t("days", { count: days }));
  if (hours > 0) parts.push(t("hours", { count: hours }));

  if (parts.length === 0) {
    if (minutes < 1) return t("justNow");
    return t("wrap", { parts: t("minutes", { count: minutes }) });
  }
  const conn = t("and");
  return t("wrap", { parts: joinCs(parts, conn) });
}

/**
 * Joins string parts as "A", "A <conn> B", or "A, B <conn> C" where
 * <conn> is the locale-specific final connector ("a"/"and"). No Oxford
 * comma — matches everyday Czech style.
 */
function joinCs(parts: readonly string[], conn: string): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} ${conn} ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} ${conn} ${parts[parts.length - 1]}`;
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

/** Formats a minute count as "X dní Y h Z min" (CZ) or "X days Y h Z min"
 *  (EN), omitting zero parts. Tuned for /statistiky's "estimated total
 *  picking time" which lands in the days range; falls through gracefully
 *  to "Y h Z min" or just "Z min" for shorter durations. Returns "—" for
 *  non-positive input.
 *
 *  The unit abbreviations `h` and `min` are kept locale-independent —
 *  both work as international SI-derived shorthands. Only the "day"
 *  word is translated. */
export function formatLongDuration(
  totalMinutes: number,
  locale?: string,
): string {
  if (totalMinutes <= 0) return "—";
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes - days * 60 * 24) / 60);
  const minutes = totalMinutes - days * 60 * 24 - hours * 60;
  const parts: string[] = [];
  if (days > 0) {
    const isEn = locale === "en" || locale?.startsWith("en-");
    const dayWord = isEn
      ? days === 1
        ? "day"
        : "days"
      : days === 1
        ? "den"
        : days < 5
          ? "dny"
          : "dní";
    parts.push(`${days} ${dayWord}`);
  }
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} min`);
  return parts.join(" ");
}

/**
 * Compact human duration from SECONDS, down to second precision — used
 * for the "fastest N consecutive finds" records where the gap can be
 * anywhere from a few seconds to several days. Shows the two most
 * significant non-zero units (e.g. "3 min 12 s", "2 h 5 min",
 * "1 den 4 h", "45 s"). Day word pluralises cs/en.
 */
export function formatDurationSeconds(
  totalSeconds: number,
  locale?: string,
): string {
  if (totalSeconds < 0) return "—";
  const s = Math.round(totalSeconds);
  if (s === 0) return "0 s";
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const isEn = locale === "en" || locale?.startsWith("en-");
  const dayWord =
    days === 1
      ? isEn
        ? "day"
        : "den"
      : isEn
        ? "days"
        : days < 5
          ? "dny"
          : "dní";
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${dayWord}`);
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (secs > 0) parts.push(`${secs} s`);
  // Two most-significant units keep the figure readable.
  return parts.slice(0, 2).join(" ");
}

/**
 * Five-digit location identifier matching the user's MAP_ID convention,
 * e.g. 1 → "#00001". Used in the find detail panel and the list view's
 * title row.
 */
export function formatLocationId(id: number): string {
  return `#${String(id).padStart(5, "0")}`;
}

/** Canonical URL for the per-location detail page. Mirrors the
 *  zero-padded display form (`#00001`) without the hash, so the
 *  query/render side and the link target stay structurally identical. */
export function locationDetailHref(id: number): string {
  return `/lokality/${String(id).padStart(5, "0")}`;
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
 *   < 100 km   → kilometres with one decimal (12.3 km)
 *   ≥ 100 km   → kilometres with three decimals (2 858,123 km)
 *
 * The three-decimal step at the high end exists so finds in the same
 * far-away location don't all collapse to the same headline number —
 * a 30 m spread across 2 858 km would otherwise read as identical
 * "2 858 km" for every clover, hiding the per-find variation that the
 * map and detail pages show. Three decimals → 1 m granularity, well
 * inside GPS noise but enough that adjacent finds always read as
 * distinct values in lists.
 */
export function formatDistance(meters: number, locale?: string): string {
  if (!Number.isFinite(meters) || meters < 0) return "";
  const lang = toIntlLocale(locale);
  if (meters < 1) {
    return `${new Intl.NumberFormat(lang).format(Math.round(meters * 100))} cm`;
  }
  if (meters < 1000) {
    return `${new Intl.NumberFormat(lang).format(Math.round(meters))} m`;
  }
  const km = meters / 1000;
  if (km < 100) {
    return `${new Intl.NumberFormat(lang, {
      maximumFractionDigits: 1,
    }).format(km)} km`;
  }
  return `${new Intl.NumberFormat(lang, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(km)} km`;
}

/** Tailwind color class for a find's offset — three-band signal:
 *
 *    green  → find is "at the location"
 *      polygon mode: GPS inside the AOI polygon
 *      centre mode:  GPS within `FIND_DEVIATION_RADIUS_M` of centre
 *
 *    amber  → find is off-target but still inside one of the
 *      location's location-map image bounding boxes (i.e. it would
 *      render as a pin inside the location-map PNG on the detail
 *      page). The visitor probably wants to double-check, but the
 *      find is plausibly in the right ballpark.
 *
 *    rose   → find is outside every one of the location's maps —
 *      "this find isn't where the location expects it" — the GPS is
 *      likely wrong or the wrong location is linked. Same band the
 *      /mapa "Skrýt odchýlené nálezy" toggle hides (yellow + red).
 *
 *  Polygon-mode `inside` and centre-mode `≤ FIND_DEVIATION_RADIUS_M`
 *  share the same green semantic; the threshold lives in constants.ts
 *  so future tweaks ripple through every render. */
export function locationOffsetToneClass(offset: {
  meters: number;
  mode: "polygon" | "center";
  inside: boolean;
  withinMap: boolean;
}): string {
  const isGreen =
    offset.mode === "polygon"
      ? offset.inside
      : offset.meters <= FIND_DEVIATION_RADIUS_M;
  if (isGreen) return "text-emerald-700 font-medium";
  if (offset.withinMap) return "text-amber-600";
  return "text-rose-600";
}

/** Background-colour class for the small location-offset indicator dot
 *  (used on the /sbirka grid cards instead of the full text label).
 *  Same graduated logic as `locationOffsetToneClass`: green = inside the
 *  AOI / within the deviation radius, amber = off but still within a
 *  location map, rose = outside every map. */
export function locationOffsetDotClass(offset: {
  meters: number;
  mode: "polygon" | "center";
  inside: boolean;
  withinMap: boolean;
}): string {
  const isGreen =
    offset.mode === "polygon"
      ? offset.inside
      : offset.meters <= FIND_DEVIATION_RADIUS_M;
  if (isGreen) return "bg-emerald-500";
  if (offset.withinMap) return "bg-amber-500";
  return "bg-rose-500";
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
 *  e.g. "12,345 / 100 m²" — five significant digits regardless of
 *  scale, so a readable column width can be reserved up-front. */
export function formatDensityPer100m2(density: number): string {
  return `${new Intl.NumberFormat("cs-CZ", {
    maximumSignificantDigits: 5,
  }).format(density)} / 100 m²`;
}
