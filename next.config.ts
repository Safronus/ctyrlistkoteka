import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl plugin reads its server-side request config from
// `src/i18n/request.ts` (locale + messages bundle per request). Wrap
// the regular config below so the plugin can hook into the build.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Content-Security-Policy is set per-request in src/middleware.ts so the
// nonce can be regenerated for every response. Static security headers
// (X-Content-Type-Options, X-Frame-Options, Referrer-Policy) stay here —
// they don't carry per-request data and the values already align with
// what nginx sets, so duplicate-with-conflicting-value HTTP headers can't
// happen.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // archiver pulls a tree of CJS deps (zip-stream, compress-commons,
  // glob, …) that Next.js's webpack server bundle reshapes into
  // `(0, _archiver.default)(...)` calls — the actual `module.exports =
  // createArchiver` function ends up wrapped into an object literal
  // and the call site throws `TypeError: k is not a function`.
  // `serverExternalPackages` opts the package out of bundling — Next
  // emits a plain `require("archiver")` and Node loads it via the
  // normal CJS resolver, which yields the function the typedef
  // promises. Same escape hatch Next applies by default for sharp /
  // prisma; we just need to register the one we add ourselves.
  serverExternalPackages: ["archiver"],
  experimental: {
    serverActions: {
      // Admin upload of find photos: each JPEG after prepare-upload is
      // typically <1 MB but we let the user batch a session's worth in
      // one submit. Cap is per-request total, not per-file. The server
      // action enforces per-file + per-request count limits on top.
      bodySizeLimit: "200mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
