/**
 * Admin-side GoatCounter API client. Sibling to `visits.ts` (which
 * only fetches the all-time footer counter) — kept separate so the
 * public site's "Návštěv: N" badge stays a single tiny query and
 * doesn't accidentally pull in the heavier admin endpoints.
 *
 * All functions degrade gracefully — missing env vars or a network
 * failure returns null / an empty result so the admin page can
 * render a "GoatCounter nedostupný" banner instead of erroring out.
 *
 * Auth: `Authorization: Bearer ${GOATCOUNTER_API_KEY}`. Token NEVER
 * leaves the server — every fetcher here is server-side only, the
 * admin page renders as an RSC.
 */

import { VISIT_TRACKING_START } from "@/lib/queries/visits";

/** GoatCounter caches per token at the API tier (15 s for /total,
 *  60 s for /hits). We pile our own Next.js cache on top — 10 min for
 *  total tiles (changes slowly), 5 min for the daily chart and the
 *  top-N tables (more dynamic, but still admin-only so a stale 5 min
 *  view is acceptable). Cache keys naturally fan out by URL so each
 *  period gets its own slot. */
const CACHE_TTL_TOTAL_SECONDS = 600;
const CACHE_TTL_DETAIL_SECONDS = 300;

export type VisitorsPeriod = "7d" | "30d" | "365d" | "all";

export const VISITORS_PERIODS: readonly VisitorsPeriod[] = [
  "7d",
  "30d",
  "365d",
  "all",
] as const;

export const VISITORS_PERIOD_LABELS: Record<VisitorsPeriod, string> = {
  "7d": "7 dní",
  "30d": "30 dní",
  "365d": "365 dní",
  all: "Vše",
};

interface DateRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Maps a UI period token to GoatCounter `start`/`end` query params.
 *  `all` pins start to VISIT_TRACKING_START so the counter is honest
 *  about its scope (mirrors `visits.ts`'s behaviour). */
export function visitorsPeriodRange(period: VisitorsPeriod): DateRange {
  const end = todayIso();
  switch (period) {
    case "7d":
      return { start: isoDaysAgo(7), end };
    case "30d":
      return { start: isoDaysAgo(30), end };
    case "365d":
      return { start: isoDaysAgo(365), end };
    case "all":
      return { start: VISIT_TRACKING_START, end };
  }
}

interface ApiContext {
  base: string;
  key: string;
}

function getApiContext(): ApiContext | null {
  const base = process.env.GOATCOUNTER_API_URL;
  const key = process.env.GOATCOUNTER_API_KEY;
  if (!base || !key) return null;
  return { base: base.replace(/\/$/, ""), key };
}

/** Skip during `next build` so the admin route's static analysis
 *  doesn't pin the build on GoatCounter availability. Live admin
 *  requests at runtime always hit through. */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

async function gcFetch(
  endpoint: string,
  ttlSeconds: number,
): Promise<unknown | null> {
  if (isBuildPhase()) return null;
  const ctx = getApiContext();
  if (!ctx) return null;
  try {
    const r = await fetch(`${ctx.base}/api/v0${endpoint}`, {
      headers: { Authorization: `Bearer ${ctx.key}` },
      next: { revalidate: ttlSeconds },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    // DNS / network / TLS errors all swallowed — caller renders the
    // "API nedostupný" banner in the same code path as missing env
    // vars, so the operator sees one clear remediation hint.
    return null;
  }
}

// ─── /stats/total ───────────────────────────────────────────────────

export interface VisitorsTotal {
  total: number;
  totalUnique: number;
}

export async function getVisitorsTotal(
  period: VisitorsPeriod,
): Promise<VisitorsTotal | null> {
  const { start, end } = visitorsPeriodRange(period);
  const data = await gcFetch(
    `/stats/total?start=${start}&end=${end}`,
    CACHE_TTL_TOTAL_SECONDS,
  );
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  const total = typeof obj.total === "number" ? obj.total : null;
  const totalUnique =
    typeof obj.total_unique === "number" ? obj.total_unique : null;
  if (total === null) return null;
  return { total, totalUnique: totalUnique ?? 0 };
}

// ─── /stats/hits — daily aggregation ────────────────────────────────

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  hits: number;
  hitsUnique: number;
}

/** Returns one row per calendar day in the period (UTC), summing
 *  hits across all paths. Hits come from `/stats/hits?daily=true`
 *  which returns a per-path matrix; we collapse it into a single
 *  series for the chart. */
export async function getVisitorsDaily(
  period: VisitorsPeriod,
): Promise<DailyPoint[]> {
  const { start, end } = visitorsPeriodRange(period);
  // `limit=100` is generous for a single-author site; the docs cap
  // at 100 per request. If a future bigger site overflows it the
  // chart still degrades to "top 100 paths' daily totals" which is
  // close enough to the true daily total for a glance.
  const data = await gcFetch(
    `/stats/hits?start=${start}&end=${end}&daily=true&limit=100`,
    CACHE_TTL_DETAIL_SECONDS,
  );
  if (typeof data !== "object" || data === null) return [];
  const hits = (data as { hits?: unknown }).hits;
  if (!Array.isArray(hits)) return [];
  const byDate = new Map<string, { hits: number; hitsUnique: number }>();
  for (const h of hits) {
    if (typeof h !== "object" || h === null) continue;
    const stats = (h as { stats?: unknown }).stats;
    if (!Array.isArray(stats)) continue;
    for (const s of stats) {
      if (typeof s !== "object" || s === null) continue;
      const day = (s as { day?: unknown }).day;
      const daily = (s as { daily?: unknown }).daily;
      const dailyUnique = (s as { daily_unique?: unknown }).daily_unique;
      if (typeof day !== "string") continue;
      if (typeof daily !== "number") continue;
      const prev = byDate.get(day) ?? { hits: 0, hitsUnique: 0 };
      prev.hits += daily;
      if (typeof dailyUnique === "number") prev.hitsUnique += dailyUnique;
      byDate.set(day, prev);
    }
  }
  return [...byDate.entries()]
    .map(([date, v]) => ({ date, hits: v.hits, hitsUnique: v.hitsUnique }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── /stats/hits — top pages ────────────────────────────────────────

export interface TopPath {
  path: string;
  title: string | null;
  hits: number;
  hitsUnique: number;
}

export async function getVisitorsTopPaths(
  period: VisitorsPeriod,
  limit = 15,
): Promise<TopPath[]> {
  const { start, end } = visitorsPeriodRange(period);
  const data = await gcFetch(
    `/stats/hits?start=${start}&end=${end}&limit=${limit}`,
    CACHE_TTL_DETAIL_SECONDS,
  );
  if (typeof data !== "object" || data === null) return [];
  const hits = (data as { hits?: unknown }).hits;
  if (!Array.isArray(hits)) return [];
  const out: TopPath[] = [];
  for (const h of hits) {
    if (typeof h !== "object" || h === null) continue;
    const row = h as Record<string, unknown>;
    const path = typeof row.path === "string" ? row.path : null;
    const title = typeof row.title === "string" ? row.title : null;
    const count = typeof row.count === "number" ? row.count : null;
    const countUnique =
      typeof row.count_unique === "number" ? row.count_unique : null;
    if (path === null || count === null) continue;
    out.push({
      path,
      title: title && title.trim() ? title : null,
      hits: count,
      hitsUnique: countUnique ?? 0,
    });
  }
  out.sort((a, b) => b.hits - a.hits);
  return out.slice(0, limit);
}

// ─── /stats/toprefs ─────────────────────────────────────────────────

export interface TopRef {
  name: string;
  hits: number;
  hitsUnique: number;
}

export async function getVisitorsTopRefs(
  period: VisitorsPeriod,
  limit = 10,
): Promise<TopRef[]> {
  return fetchTopStats(period, "toprefs", limit);
}

// ─── /stats/browsers ───────────────────────────────────────────────

export async function getVisitorsBrowsers(
  period: VisitorsPeriod,
  limit = 8,
): Promise<TopRef[]> {
  return fetchTopStats(period, "browsers", limit);
}

// ─── /stats/locations ──────────────────────────────────────────────

export async function getVisitorsLocations(
  period: VisitorsPeriod,
  limit = 10,
): Promise<TopRef[]> {
  return fetchTopStats(period, "locations", limit);
}

async function fetchTopStats(
  period: VisitorsPeriod,
  stat: "toprefs" | "browsers" | "locations",
  limit: number,
): Promise<TopRef[]> {
  const { start, end } = visitorsPeriodRange(period);
  const data = await gcFetch(
    `/stats/${stat}?start=${start}&end=${end}&limit=${limit}`,
    CACHE_TTL_DETAIL_SECONDS,
  );
  if (typeof data !== "object" || data === null) return [];
  const stats = (data as { stats?: unknown }).stats;
  if (!Array.isArray(stats)) return [];
  const out: TopRef[] = [];
  for (const s of stats) {
    if (typeof s !== "object" || s === null) continue;
    const row = s as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name : null;
    const id = typeof row.id === "string" ? row.id : null;
    const count = typeof row.count === "number" ? row.count : null;
    const countUnique =
      typeof row.count_unique === "number" ? row.count_unique : null;
    const label = name?.trim() || id?.trim();
    if (!label || count === null) continue;
    out.push({
      name: label,
      hits: count,
      hitsUnique: countUnique ?? 0,
    });
  }
  out.sort((a, b) => b.hits - a.hits);
  return out.slice(0, limit);
}

/** True when env vars for the GC API are present. Lets the admin
 *  page render a config banner instead of empty tables when the
 *  operator forgot to set GOATCOUNTER_API_KEY. */
export function isGoatCounterConfigured(): boolean {
  return !!(
    process.env.GOATCOUNTER_API_URL && process.env.GOATCOUNTER_API_KEY
  );
}
