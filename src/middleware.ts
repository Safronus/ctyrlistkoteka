/**
 * Per-request CSP with a nonce for inline scripts.
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

const isDev = process.env.NODE_ENV !== "production";

function buildCsp(nonce: string): string {
  if (isDev) {
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
      "font-src 'self'",
      // ws / wss let the HMR websocket connect.
      "connect-src 'self' ws: wss: https://*.tile.openstreetmap.org",
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
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
    "font-src 'self'",
    "connect-src 'self' https://*.tile.openstreetmap.org",
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

  // Forward the nonce to downstream server components by mutating the
  // *request* headers — this is the canonical Next.js pattern for
  // bridging middleware data into RSC.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Skip static assets, images, manifest-style files, and the API
      // surface (JSON-only — no HTML to constrain). Everything else
      // gets the CSP.
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|favicon.svg|clover.png|safronus.png|robots.txt|sitemap.xml).*)",
      // Don't issue a fresh nonce for prefetch requests — the resulting
      // CSP wouldn't be visible to the user anyway and the work just
      // burns CPU during link prefetching.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
