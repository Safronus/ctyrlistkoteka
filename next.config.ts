import type { NextConfig } from "next";

// Content-Security-Policy is set per-request in src/middleware.ts so the
// nonce can be regenerated for every response. Static security headers
// (X-Content-Type-Options, X-Frame-Options, Referrer-Policy) stay here —
// they don't carry per-request data and the values already align with
// what nginx sets, so duplicate-with-conflicting-value HTTP headers can't
// happen.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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

export default nextConfig;
