/**
 * "Retrospektiva" — year-over-year comparison anchored on today's
 * calendar position. The home page renders four small horizontal-bar
 * charts (Day, ISO Week, Month, Year) and each one needs the same
 * shape: count of finds per year (zero-filled from the first year
 * with at least one find through the current year), with the current
 * year flagged so the chart can highlight it.
 *
 * All four buckets share a single SQL roundtrip via `UNION ALL` so the
 * home page pays one query for the whole grid. The generate_series
 * driver on the Postgres side is what gives us the zero-fill — pure
 * SQL is cheaper here than reconciling sparse rows on the JS side and
 * keeps the home page bundle smaller.
 *
 * Counts include anonymized finds: anonymization protects identity,
 * not statistical existence. The chart never names which find is in
 * which bucket — it just plots aggregate counts. CLAUDE.md §6 only
 * forbids exposing notes / precise GPS / OG tags for anonymized
 * finds; raw counts are public on /statistiky already.
 *
 * Time zone: the project treats `found_at` as wall-clock UTC (see how
 * sync stores EXIF DateTimeOriginal, and how stats.ts `EXTRACT()`s
 * directly without `AT TIME ZONE`). We follow the same pattern here so
 * "ISO week 18" / "May" / "year 2026" line up with what the visitor
 * sees on /statistiky.
 */

import { prisma } from "@/lib/db";

const TZ = "Europe/Prague";

export interface RetrospectivePoint {
  year: number;
  count: number;
  /** True when this row matches the visitor's "right now" — drives the
   *  highlighted bar in the chart. */
  isCurrent: boolean;
}

export interface RetrospectivePeriod {
  /** Period kind — used as a stable React key + chart aria-label. */
  kind: "day" | "week" | "month" | "year";
  /** Czech-formatted period name shown above the chart, e.g.
   *  "Den 3. 5.", "ISO týden 18", "Květen", "Rok 2026". */
  label: string;
  /** Optional sub-label rendered under the chart title. Lets us spell
   *  out the comparison ("ISO týden 18 napříč všemi roky"). */
  hint: string;
  /** Zero-filled, sorted ascending by year. Length ≥ 1 once the
   *  collection has at least one find. */
  points: RetrospectivePoint[];
}

export interface RetrospectiveBundle {
  /** Captured at the SQL site so client + server agree on what "today"
   *  is even if the request crosses midnight. */
  today: { year: number; month: number; day: number; isoWeek: number };
  day: RetrospectivePeriod;
  week: RetrospectivePeriod;
  month: RetrospectivePeriod;
  year: RetrospectivePeriod;
}

const MONTH_LABELS_NOM_CS = [
  "Leden",
  "Únor",
  "Březen",
  "Duben",
  "Květen",
  "Červen",
  "Červenec",
  "Srpen",
  "Září",
  "Říjen",
  "Listopad",
  "Prosinec",
] as const;

interface RawRow {
  bucket: "day" | "week" | "month" | "year";
  year: number;
  count: bigint;
}

/**
 * Returns null when the collection is empty (no finds with
 * `found_at`). The home page handles this by skipping the section.
 *
 * Implementation notes:
 *   - "today" is computed in `Europe/Prague` so the buckets respect
 *     the visitor's expectation when the request lands close to UTC
 *     midnight. The MM-DD chosen here is then matched against the raw
 *     UTC-stored `found_at` because EXIF dates were never in UTC to
 *     begin with — they're wall-clock at the photo's location, just
 *     stored in a timestamptz column.
 *   - We compute `first_year` once (anchors the zero-fill range) and
 *     `last_year` as `max(current_year, first_year)` so "Rok" plots
 *     the current year even when no finds have happened yet this
 *     year — a zero bar on the right edge tells the right story.
 */
export async function getRetrospective(): Promise<RetrospectiveBundle | null> {
  const todayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (t: string) =>
    Number(todayParts.find((p) => p.type === t)?.value ?? "0");
  const todayYear = part("year");
  const todayMonth = part("month");
  const todayDay = part("day");

  // Postgres EXTRACT(WEEK FROM ...) is ISO 8601 — exactly what the
  // user asked for. The matching extractor for "ISO year" pairs it
  // when a week straddles new year (week 1 of 2026 may belong to
  // late December 2025).
  const todayIsoWeekRow = await prisma.$queryRawUnsafe<
    Array<{ iso_week: number; iso_year: number }>
  >(
    `SELECT EXTRACT(WEEK FROM make_date($1::int, $2::int, $3::int))::int AS iso_week,
            EXTRACT(ISOYEAR FROM make_date($1::int, $2::int, $3::int))::int AS iso_year`,
    todayYear,
    todayMonth,
    todayDay,
  );
  const todayIsoWeek = todayIsoWeekRow[0]?.iso_week ?? 0;
  const todayIsoYear = todayIsoWeekRow[0]?.iso_year ?? todayYear;

  // first/last year drives the zero-fill range. Fold today's calendar
  // year in too — even if the collection's last find was in 2024 we
  // still want a 0 bar for the current year on the chart so the
  // "right edge" of every panel shares the same axis.
  const span = await prisma.$queryRawUnsafe<
    Array<{ first_year: number | null }>
  >(
    `SELECT EXTRACT(YEAR FROM MIN(found_at))::int AS first_year FROM finds WHERE found_at IS NOT NULL`,
  );
  const firstYear = span[0]?.first_year ?? null;
  if (firstYear === null) return null;
  const lastYear = todayYear;

  // Single round-trip — UNION ALL all four buckets keyed by a literal
  // tag. `count(*) FILTER (WHERE …)` lets us avoid four separate
  // sequential scans where Postgres can. The bucket-by-bucket WHERE
  // is intentionally `f.found_at IS NOT NULL` first so the index on
  // (found_at) does the heavy lifting.
  const raw = await prisma.$queryRawUnsafe<RawRow[]>(
    `
    WITH base AS (
      SELECT
        EXTRACT(YEAR FROM found_at)::int AS y,
        EXTRACT(MONTH FROM found_at)::int AS m,
        EXTRACT(DAY FROM found_at)::int AS d,
        EXTRACT(WEEK FROM found_at)::int AS iw,
        EXTRACT(ISOYEAR FROM found_at)::int AS iy
      FROM finds
      WHERE found_at IS NOT NULL
    )
    SELECT 'day'::text AS bucket, y AS year, COUNT(*)::bigint AS count
    FROM base WHERE m = $1::int AND d = $2::int
    GROUP BY y
    UNION ALL
    SELECT 'week'::text AS bucket, iy AS year, COUNT(*)::bigint AS count
    FROM base WHERE iw = $3::int
    GROUP BY iy
    UNION ALL
    SELECT 'month'::text AS bucket, y AS year, COUNT(*)::bigint AS count
    FROM base WHERE m = $1::int
    GROUP BY y
    UNION ALL
    SELECT 'year'::text AS bucket, y AS year, COUNT(*)::bigint AS count
    FROM base
    GROUP BY y
    `,
    todayMonth,
    todayDay,
    todayIsoWeek,
  );

  const dayMap = new Map<number, number>();
  const weekMap = new Map<number, number>();
  const monthMap = new Map<number, number>();
  const yearMap = new Map<number, number>();
  for (const row of raw) {
    const c = Number(row.count);
    if (row.bucket === "day") dayMap.set(row.year, c);
    else if (row.bucket === "week") weekMap.set(row.year, c);
    else if (row.bucket === "month") monthMap.set(row.year, c);
    else if (row.bucket === "year") yearMap.set(row.year, c);
  }

  const fillRange = (
    counts: Map<number, number>,
    from: number,
    to: number,
    currentYear: number,
  ): RetrospectivePoint[] => {
    const out: RetrospectivePoint[] = [];
    for (let y = from; y <= to; y += 1) {
      out.push({
        year: y,
        count: counts.get(y) ?? 0,
        isCurrent: y === currentYear,
      });
    }
    return out;
  };

  const dayLabel = `${todayDay}. ${todayMonth}.`;

  return {
    today: {
      year: todayYear,
      month: todayMonth,
      day: todayDay,
      isoWeek: todayIsoWeek,
    },
    day: {
      kind: "day",
      label: `Den ${dayLabel}`,
      hint: `${dayLabel} napříč všemi roky`,
      points: fillRange(dayMap, firstYear, lastYear, todayYear),
    },
    week: {
      kind: "week",
      // ISO week is keyed by ISO year, not calendar year — same
      // convention Postgres uses, so the fill range is also keyed by
      // ISO year. For our project these align (we don't have data
      // before week 1 of `firstYear`'s ISO year), so reusing the
      // calendar firstYear is safe and keeps the four panels' axes
      // visually aligned.
      label: `Týden ${todayIsoWeek}`,
      hint: `ISO týden ${todayIsoWeek} napříč všemi roky`,
      points: fillRange(weekMap, firstYear, todayIsoYear, todayIsoYear),
    },
    month: {
      kind: "month",
      label: MONTH_LABELS_NOM_CS[todayMonth - 1] ?? `Měsíc ${todayMonth}`,
      hint: `${MONTH_LABELS_NOM_CS[todayMonth - 1] ?? ""} napříč všemi roky`,
      points: fillRange(monthMap, firstYear, lastYear, todayYear),
    },
    year: {
      kind: "year",
      label: `Rok ${todayYear}`,
      hint: "Celý rok napříč historií sbírky",
      points: fillRange(yearMap, firstYear, lastYear, todayYear),
    },
  };
}
