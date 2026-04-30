/**
 * GoatCounter pixel — registers a pageview on every full page load by
 * embedding the standard async `<script src=".../count.js">` snippet.
 * Returns null when NEXT_PUBLIC_GOATCOUNTER_SITE is empty so the
 * tracking is opt-in via env config (also handy for local dev where
 * we don't want to pollute production stats).
 *
 * `async` defers execution until the HTML is parsed, so this never
 * blocks first paint. Same caveat as any third-party script: if the
 * container is offline the request fails silently.
 *
 * GoatCounter's client-side script auto-binds to client-side route
 * changes via `pushState`, so SPA navigations inside Next.js are
 * counted as separate pageviews — no extra wiring needed here.
 *
 * Reads `x-nonce` from the request headers (set by `src/middleware.ts`)
 * and stamps it onto the `<script>` tag so the production CSP —
 * `script-src 'self' 'nonce-…' 'strict-dynamic'` — actually loads
 * this external script. Without the nonce the browser silently drops
 * it and no pageviews ever reach GoatCounter (debugging-flag value:
 * we burned an afternoon on this once).
 */
import { headers } from "next/headers";

export async function GoatCounterScript() {
  const site = process.env.NEXT_PUBLIC_GOATCOUNTER_SITE;
  if (!site) return null;
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const cleaned = site.replace(/\/$/, "");
  return (
    <script
      async
      data-goatcounter={`${cleaned}/count`}
      src={`${cleaned}/count.js`}
      nonce={nonce}
    />
  );
}
