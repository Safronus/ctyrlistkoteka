import { NextResponse } from "next/server";
import { getRandomFindShowcase } from "@/lib/queries/random-find";

/**
 * Returns a single random find for the home-page showcase widget.
 * Picks a fresh row on every request so the manual "Další" button can
 * surface a new find immediately; rotation cadence is enforced by the
 * `cache-control` header (60 s shared cache) and the widget's
 * `setInterval` rather than by server-side memoization.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getRandomFindShowcase();
  return NextResponse.json(data, {
    headers: {
      // 60 s browser/CDN cache aligns with the widget's 1-min auto
      // refresh — under steady load most ticks resolve from cache.
      // The widget passes `cache: "no-store"` for the manual refresh
      // button so the user always gets a brand-new find on click.
      "cache-control": "public, max-age=60",
    },
  });
}
