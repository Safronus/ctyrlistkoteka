import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl plugin reads its server-side request config from
// `src/i18n/request.ts` (locale + messages bundle per request). Wrap
// the regular config below so the plugin can hook into the build.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Total commit count on HEAD, baked into the bundle at build time — the
// footer shows it as a "build number" next to the GitHub link. The VPS
// deploy builds from a full `git reset --hard origin/main` checkout so
// the count is accurate there; falls back to "" (footer hides it) when
// git isn't available (e.g. a tarball build).
function gitCommitCount(): string {
  try {
    return execSync("git rev-list --count HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

// Content-Security-Policy is set per-request in src/middleware.ts so the
// nonce can be regenerated for every response. Static security headers
// (X-Content-Type-Options, X-Frame-Options, Referrer-Policy) stay here —
// they don't carry per-request data and the values already align with
// what nginx sets, so duplicate-with-conflicting-value HTTP headers can't
// happen.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_COMMIT_COUNT: gitCommitCount(),
  },
  // Packages that must stay OUT of the server bundle and be required from
  // node_modules at runtime:
  //  - yauzl (streaming unzip for the /admin package import) — bundling breaks
  //    its CJS interop (archiver broke exactly this way — see qr-zip).
  //  - exifr — ships a UMD build that sniffs the environment at runtime to pick
  //    its Node file reader. Bundled, that detection breaks and
  //    `exifr.parse(<path>)` throws, so readExifSafe silently returned nulls
  //    and EVERY admin upload reported "chybí EXIF DateTimeOriginal" even for
  //    photos that have it. (scripts/sync.ts was unaffected — it runs under
  //    tsx, unbundled — so foundAt in the DB was always correct.)
  serverExternalPackages: ["yauzl", "exifr"],
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
