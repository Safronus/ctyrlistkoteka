/**
 * GoatCounter total-visits fetcher. The footer's small "Návštěv: N"
 * badge calls this; failures collapse to null so the counter component
 * can render its "???" fallback instead of breaking layout.
 *
 * GoatCounter exposes /api/v0/stats/total?start=YYYY-MM-DD which sums
 * pageviews from `start` through today. We pin `start` to the project's
 * tracking-deployment date so the counter is honest about its scope —
 * no fake "from launch" values that weren't actually recorded.
 *
 * Cached at the Next.js fetch layer for 10 minutes — keeps the badge
 * near-real-time without hammering the GoatCounter container with
 * one request per page render.
 */

/** Date the GoatCounter container was first pointed at the production
 *  domain. Surfaced in the counter's tooltip as the start of the
 *  tracking window. ISO so locale formatting stays in the UI layer. */
export const VISIT_TRACKING_START = "2026-04-30";

const CACHE_TTL_SECONDS = 600;

export interface VisitTotal {
  total: number;
  /** ISO date the counter started counting from. */
  startedAt: string;
}

export async function getTotalVisits(): Promise<VisitTotal | null> {
  const base = process.env.GOATCOUNTER_API_URL;
  const key = process.env.GOATCOUNTER_API_KEY;
  if (!base || !key) return null;
  try {
    const url = `${base.replace(/\/$/, "")}/api/v0/stats/total?start=${VISIT_TRACKING_START}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      next: { revalidate: CACHE_TTL_SECONDS },
    });
    if (!r.ok) return null;
    const data: unknown = await r.json();
    if (typeof data !== "object" || data === null) return null;
    const total = (data as { total?: unknown }).total;
    if (typeof total !== "number" || !Number.isFinite(total)) return null;
    return { total, startedAt: VISIT_TRACKING_START };
  } catch {
    // Network error / DNS failure / GoatCounter down — treat all as
    // "no data right now". Caller renders the "???" fallback.
    return null;
  }
}
