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
 */
export function GoatCounterScript() {
  const site = process.env.NEXT_PUBLIC_GOATCOUNTER_SITE;
  if (!site) return null;
  const cleaned = site.replace(/\/$/, "");
  return (
    <script
      async
      data-goatcounter={`${cleaned}/count`}
      src={`${cleaned}/count.js`}
    />
  );
}
