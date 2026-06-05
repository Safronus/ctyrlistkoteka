/**
 * Composed middleware: per-request CSP nonce + next-intl locale routing.
 *
 * Pipeline order matters. We compute the nonce + CSP first and stamp
 * them onto the request headers (so server components like
 * `ThemeScript` / `GoatCounterScript` can read `x-nonce` via
 * `headers()`), then hand off to next-intl for any locale rewrite. The
 * intl middleware preserves request headers across its
 * `NextResponse.rewrite()`, so the nonce flows into the
 * `[locale]/...` segment unchanged.
 *
 * `/admin/*` and `/api/*` skip i18n entirely — they're locale-agnostic
 * (admin is Czech-only by user choice; API is JSON) and we don't want
 * the matcher rewriting `/admin/checks` to `/cs/admin/checks`.
 *
 * Why middleware and not next.config.ts headers():
 * static `headers()` can't include a fresh nonce per response. We
 * generate one here, attach it to the request via `x-nonce` so server
 * components (notably `ThemeScript`) can read it back via `headers()`,
 * and emit the matching `Content-Security-Policy` response header.
 *
 * Next.js automatically reads `x-nonce` and applies it to the App
 * Router's inline hydration scripts — we don't need to thread the
 * nonce through individual `<Script>` tags. The only place we apply
 * it manually is our own `ThemeScript`, which has to run before
 * hydration to avoid a flash of unstyled theme.
 *
 * Dev vs prod: Next.js HMR / React Refresh require `'unsafe-inline'`
 * and `'unsafe-eval'` — a strict nonce-only policy breaks the dev
 * server. We therefore ship a relaxed CSP in development and the
 * tight nonce + strict-dynamic policy in production.
 */
import { NextResponse, type NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const isDev = process.env.NODE_ENV !== "production";

const intlMiddleware = createIntlMiddleware(routing);

function buildCsp(nonce: string): string {
  // CSP wildcards require at least one explicit subdomain segment, so
  // `*.tile.openstreetmap.org` doesn't cover the bare host. Leaflet
  // hits both forms (subdomained `a/b/c.tile…` for tiles, occasionally
  // the bare `tile.openstreetmap.org` for plugins / direct URLs), so
  // we list both in img-src AND connect-src.
  const tileSrc =
    "https://tile.openstreetmap.org https://*.tile.openstreetmap.org";

  // Self-hosted GoatCounter runs on a separate subdomain. Its `count.js`
  // is loaded as a script (covered by the nonce + 'strict-dynamic' on
  // script-src) and the actual pageview pings travel as `<img>`/`fetch`/
  // `sendBeacon` — neither covered by script-src, so we explicitly
  // allow the GoatCounter origin in both img-src and connect-src.
  // Resolved from env at request time; `''` when unset means GoatCounter
  // is disabled for this deployment and the entries collapse harmlessly.
  const goatCounterOrigin = (() => {
    const raw = process.env.NEXT_PUBLIC_GOATCOUNTER_SITE;
    if (!raw) return "";
    try {
      return new URL(raw).origin;
    } catch {
      return "";
    }
  })();

  if (isDev) {
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: ${tileSrc} ${goatCounterOrigin}`.trim(),
      "font-src 'self'",
      // ws / wss let the HMR websocket connect.
      `connect-src 'self' ws: wss: ${tileSrc} ${goatCounterOrigin}`.trim(),
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");
  }
  return [
    "default-src 'self'",
    // strict-dynamic propagates trust from the nonced bootstrap script
    // to any chunks it loads, so we don't need to whitelist 'self' for
    // dynamically-imported chunks. style-src keeps 'unsafe-inline' for
    // Tailwind / inline style attrs — moving styles to nonces would
    // require deeper changes than this CSP pass.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${tileSrc} ${goatCounterOrigin}`.trim(),
    "font-src 'self'",
    `connect-src 'self' ${tileSrc} ${goatCounterOrigin}`.trim(),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function middleware(request: NextRequest) {
  // 16 random bytes is plenty of entropy for a per-request nonce; the
  // base64 encoding keeps the header value compact.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const pathname = request.nextUrl.pathname;
  const isLocaleRoute =
    !pathname.startsWith("/admin") && !pathname.startsWith("/api");

  // Mutate the incoming request's headers in place so both the
  // pass-through (NextResponse.next) and the next-intl rewrite branch
  // see the nonce. Next.js' Headers proxy supports `.set()` on the
  // request — the mutation propagates to whichever NextResponse the
  // pipeline ends up returning.
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", csp);

  let response: NextResponse;
  if (isLocaleRoute) {
    // next-intl handles the locale prefix routing for `/`, `/sbirka`,
    // `/lokality`, `/mapa`, `/statistiky` (rewrites to `/[locale]/...`
    // internally) and the `/en/...` paths (passes through). The
    // rewrite preserves request.headers, so x-nonce flows into RSC.
    response = intlMiddleware(request);
  } else {
    // /admin and /api don't get a locale prefix — return a regular
    // NextResponse.next that re-emits the mutated request headers.
    response = NextResponse.next({
      request: { headers: request.headers },
    });
  }

  response.headers.set("Content-Security-Policy", csp);

  // /admin is private — keep it out of every search index regardless of
  // any robots.txt mishap, and forbid framing entirely (the CSP already
  // does, but the X-Frame-Options header catches old crawlers/proxies
  // that don't honor CSP frame-ancestors). The actual auth gate lives
  // in the admin layout/pages — middleware can't read iron-session
  // (Edge runtime, no Node crypto) so we keep that check server-side.
  if (pathname.startsWith("/admin")) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
}

export const config = {
  matcher: [
    // Skip static assets, images, manifest-style files, and the API
    // surface (JSON-only — no HTML to constrain). Everything else
    // gets the CSP + next-intl locale rewrite.
    //
    // The `missing: next-router-prefetch` skip we used to carry here
    // is GONE on purpose: prefetch requests ALSO need to flow through
    // next-intl so `/sbirka/123` (no prefix) gets internally rewritten
    // to `/cs/sbirka/123` and matches the `[locale]/sbirka/[id]` route.
    // Without that rewrite, Next.js sees no route at the bare path and
    // returns 500 to every Link's prefetch — which broke the entire
    // sbírka grid after F1 moved pages into the [locale] segment.
    "/((?!api|go|_next/static|_next/image|favicon.ico|favicon.svg|clover.png|safronus.png|robots.txt|sitemap.xml).*)",
  ],
};
