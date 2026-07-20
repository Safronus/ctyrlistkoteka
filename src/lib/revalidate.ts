import { revalidatePath, revalidateTag } from "next/cache";

/**
 * Invalidate every cache layer that depends on freshly synced data, so the
 * public site reflects a sync immediately instead of serving stale numbers
 * until each cache's revalidate window elapses.
 *
 * Two layers matter:
 *   1. `revalidateTag("stats")` — drops the `unstable_cache` stats
 *      aggregations (the only tagged data cache; see queries/stats.ts). This
 *      is what actually fixes /statistiky and the home-page stat panels,
 *      which otherwise serve up-to-6h-stale numbers even on a dynamic render
 *      because the DATA is cached under the tag, independent of the page.
 *   2. `revalidatePath(...)` — drops the ISR route caches for the pages that
 *      cache their render (`/` = revalidate 3600, `/statistiky` = 21600).
 *      /sbirka, /mapa and /lokality are `force-dynamic`, so revalidating
 *      them is a cheap no-op — kept for clarity and to stay correct if any
 *      is ever switched back to ISR.
 *
 * Safe under PM2 cluster mode: both `revalidateTag` and `revalidatePath`
 * write to the shared on-disk `.next/cache`, which every worker consults on
 * its next read. Only callable inside the Next.js runtime (route handler /
 * server action) — a standalone CLI must POST `/api/admin/revalidate`
 * instead (which calls this).
 */
export function revalidatePublicSurfaces(): void {
  // The cacheLife profile (2nd arg) is required as of Next.js 16 — the
  // single-argument form is a type error. "max" expires the entry as far as
  // the profile allows while keeping stale-while-revalidate semantics, which
  // is what we want: a visitor mid-sync gets the previous numbers rather than
  // a blocking recompute over ~17k finds. `updateTag` (read-your-writes) is
  // the alternative, but it's Server-Actions-only and this runs from a route
  // handler.
  revalidateTag("stats", "max");
  for (const p of ["/", "/sbirka", "/statistiky", "/lokality", "/mapa"]) {
    revalidatePath(p);
  }
}
