import { prisma } from "@/lib/db";
import { COLLECTION_TIME_ZONE } from "@/lib/collectionTime";

/**
 * Scan statistics for CaSQB codes — everything a bare timestamp can say.
 *
 * A scan row is one `scanned_at` and nothing else (no IP, agent, language
 * or place), so every figure here is a count over time: per day, per
 * hour of day, per weekday. "Unique visitors" is deliberately absent — it
 * needs a device fingerprint, and a fingerprint is personal data.
 *
 * Bucketing happens in SQL, in the collection's zone: a scan at 00:30 in
 * Prague is that day's, whatever UTC says. The server runs in UTC.
 */

const TZ = COLLECTION_TIME_ZONE;
const DAY_MS = 24 * 60 * 60 * 1000;

export const CASQB_HORIZONS = [7, 30, 90, 365, 0] as const;
/** 0 = everything since the code was created. */
export type CasqbHorizon = (typeof CASQB_HORIZONS)[number];

export interface CasqbDayCount {
  /** YYYY-MM-DD in Europe/Prague. */
  day: string;
  count: number;
}

export interface CasqbCodeStats {
  total: number;
  last7: number;
  last30: number;
  /** Scans inside the chosen horizon (= total when horizon is 0). */
  inHorizon: number;
  /** Days the horizon spans (for the per-day average). */
  horizonDays: number;
  perDay: number;
  first: Date | null;
  last: Date | null;
  bestDay: CasqbDayCount | null;
  /** Scans logged after the code was retired — the code keeps
   *  redirecting on purpose, and these say how alive a retired print
   *  still is. */
  afterRetire: number;
  /** One entry per day of the horizon, zero-filled, oldest first. */
  byDay: CasqbDayCount[];
  /** 24 entries, 0–23, Prague time. */
  byHour: number[];
  /** 7 entries, Monday first. */
  byWeekday: number[];
}

function pragueDay(d: Date): string {
  // en-CA gives ISO order; the zone does the rest.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Last `days` days of per-code daily counts for every casqb code —
 *  the sparkline beside each row. One query, however many codes. */
export async function casqbSparklines(
  days = 14,
  now = new Date(),
): Promise<Map<number, number[]>> {
  const since = new Date(now.getTime() - (days - 1) * DAY_MS);
  const rows = await prisma.$queryRaw<
    Array<{ qr_code_id: number; day: string; n: bigint }>
  >`
    SELECT s.qr_code_id,
           to_char((s.scanned_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day,
           COUNT(*) AS n
    FROM qr_scans s
    JOIN qr_codes c ON c.id = s.qr_code_id
    WHERE c.kind = 'casqb' AND s.scanned_at >= ${since}
    GROUP BY 1, 2
  `;
  const today = pragueDay(now);
  const start = addDays(today, -(days - 1));
  const index = new Map<string, number>();
  for (let i = 0; i < days; i++) index.set(addDays(start, i), i);
  const out = new Map<number, number[]>();
  for (const r of rows) {
    const i = index.get(r.day);
    if (i === undefined) continue;
    const arr = out.get(r.qr_code_id) ?? new Array<number>(days).fill(0);
    arr[i] = Number(r.n);
    out.set(r.qr_code_id, arr);
  }
  return out;
}

/** Everything the stats page shows for one code. */
export async function casqbCodeStats(
  codeId: number,
  horizon: CasqbHorizon,
  now = new Date(),
): Promise<CasqbCodeStats | null> {
  const code = await prisma.qrCode.findUnique({
    where: { id: codeId },
    select: { id: true, kind: true, createdAt: true, archivedAt: true },
  });
  if (!code || code.kind !== "casqb") return null;

  const today = pragueDay(now);
  const createdDay = pragueDay(code.createdAt);
  // Horizon 0 = from creation; anything else = the last N days
  // including today. The window never starts before the code existed.
  let startDay = horizon === 0 ? createdDay : addDays(today, -(horizon - 1));
  if (startDay < createdDay) startDay = createdDay;
  const horizonDays = Math.max(
    1,
    Math.round(
      (Date.UTC(...isoParts(today)) - Date.UTC(...isoParts(startDay))) / DAY_MS,
    ) + 1,
  );

  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const [totals, byDayRows, byHourRows, byWeekdayRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        total: bigint;
        last7: bigint;
        last30: bigint;
        first: Date | null;
        last: Date | null;
        after_retire: bigint;
      }>
    >`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE s.scanned_at >= ${since7}) AS last7,
             COUNT(*) FILTER (WHERE s.scanned_at >= ${since30}) AS last30,
             MIN(s.scanned_at) AS first,
             MAX(s.scanned_at) AS last,
             COUNT(*) FILTER (WHERE ${code.archivedAt}::timestamptz IS NOT NULL
                                AND s.scanned_at > ${code.archivedAt}::timestamptz) AS after_retire
      FROM qr_scans s
      WHERE s.qr_code_id = ${codeId}
    `,
    prisma.$queryRaw<Array<{ day: string; n: bigint }>>`
      SELECT to_char((s.scanned_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day,
             COUNT(*) AS n
      FROM qr_scans s
      WHERE s.qr_code_id = ${codeId}
        AND (s.scanned_at AT TIME ZONE ${TZ})::date >= ${startDay}::date
      GROUP BY 1
    `,
    prisma.$queryRaw<Array<{ h: number; n: bigint }>>`
      SELECT EXTRACT(HOUR FROM (s.scanned_at AT TIME ZONE ${TZ}))::int AS h,
             COUNT(*) AS n
      FROM qr_scans s
      WHERE s.qr_code_id = ${codeId}
        AND (s.scanned_at AT TIME ZONE ${TZ})::date >= ${startDay}::date
      GROUP BY 1
    `,
    prisma.$queryRaw<Array<{ d: number; n: bigint }>>`
      SELECT EXTRACT(ISODOW FROM (s.scanned_at AT TIME ZONE ${TZ}))::int AS d,
             COUNT(*) AS n
      FROM qr_scans s
      WHERE s.qr_code_id = ${codeId}
        AND (s.scanned_at AT TIME ZONE ${TZ})::date >= ${startDay}::date
      GROUP BY 1
    `,
  ]);

  const t = totals[0];
  const dayMap = new Map(byDayRows.map((r) => [r.day, Number(r.n)]));
  const byDay: CasqbDayCount[] = [];
  for (let i = 0; i < horizonDays; i++) {
    const day = addDays(startDay, i);
    byDay.push({ day, count: dayMap.get(day) ?? 0 });
  }
  const inHorizon = byDay.reduce((s, d) => s + d.count, 0);
  const bestDay = byDay.reduce<CasqbDayCount | null>(
    (best, d) => (d.count > 0 && (best === null || d.count > best.count) ? d : best),
    null,
  );
  const byHour = new Array<number>(24).fill(0);
  for (const r of byHourRows) byHour[r.h] = Number(r.n);
  const byWeekday = new Array<number>(7).fill(0);
  for (const r of byWeekdayRows) byWeekday[r.d - 1] = Number(r.n);

  return {
    total: Number(t?.total ?? 0),
    last7: Number(t?.last7 ?? 0),
    last30: Number(t?.last30 ?? 0),
    inHorizon,
    horizonDays,
    perDay: inHorizon / horizonDays,
    first: t?.first ?? null,
    last: t?.last ?? null,
    bestDay,
    afterRetire: Number(t?.after_retire ?? 0),
    byDay,
    byHour,
    byWeekday,
  };
}

function isoParts(day: string): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return [y, m - 1, d];
}

/** All scan timestamps of a code, oldest first — the CSV export. */
export async function casqbScanTimestamps(codeId: number): Promise<Date[]> {
  const rows = await prisma.qrScan.findMany({
    where: { qrCodeId: codeId },
    orderBy: { scannedAt: "asc" },
    select: { scannedAt: true },
  });
  return rows.map((r) => r.scannedAt);
}
