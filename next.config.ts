import type { NextConfig } from "next";

// Content-Security-Policy. Tuned for our specific surface:
//   - Next.js App Router server components emit inline hydration scripts.
//     Without a nonce-issuing middleware we keep 'unsafe-inline' for
//     script-src; revisit if/when we add such middleware.
//   - Tailwind v4 + React often write inline `style` attributes —
//     'unsafe-inline' on style-src is therefore unavoidable today.
//   - 'unsafe-eval' is required for Next.js HMR / React Refresh in dev
//     only; we drop it in production builds. The conditional matches
//     `process.env.NODE_ENV` at build time, so the prod bundle never
//     ships a relaxed policy.
//   - tile.openstreetmap.org (a/b/c subdomains) feeds Leaflet's raster
//     tiles on /mapa. Listed both in img-src (the <img> requests) and
//     connect-src (in case a plugin uses fetch()).
//   - frame-ancestors 'none' blocks framing entirely in modern browsers
//     and supersedes the legacy X-Frame-Options header below.
//   - data:/blob: in img-src cover next/image's optimized URLs and any
//     canvas/blob exports we may add later.
const isDev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
  "font-src 'self'",
  "connect-src 'self' https://*.tile.openstreetmap.org",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Legacy fallback for browsers that don't honour CSP
          // frame-ancestors. Kept at SAMEORIGIN to match the value
          // already advertised by nginx — having two XFO headers with
          // conflicting values would yield undefined client behaviour.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
