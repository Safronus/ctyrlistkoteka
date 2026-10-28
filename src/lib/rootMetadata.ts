import type { Metadata } from "next";
import { SITE_DESCRIPTION } from "@/lib/constants";
import { siteName } from "@/lib/siteName";
import { siteBaseUrl } from "@/lib/seo";

/**
 * Site-wide metadata both root layouts start from (title template, icons,
 * OpenGraph defaults, search-console verification).
 *
 * Locale-aware so the document <title> template and OpenGraph title carry
 * the English wordmark ("Safron's Luckographer") on /en pages and the
 * Czech one elsewhere — the unlocalized root (admin, /d, /tym) passes "cs".
 */
export function buildRootMetadata(locale: string): Metadata {
  const name = siteName(locale);
  return {
    title: {
      template: `%s · ${name}`,
      default: name,
    },
    description: SITE_DESCRIPTION,
    // siteBaseUrl() forces https for the real domain so canonical / OG
    // URLs (resolved against metadataBase) are never http://.
    metadataBase: new URL(siteBaseUrl()),
    icons: {
      icon: [
        { url: "/clover.png", type: "image/png" },
        { url: "/favicon.svg", type: "image/svg+xml" },
      ],
    },
    openGraph: {
      title: name,
      description: SITE_DESCRIPTION,
      type: "website",
    },
    robots: {
      index: true,
      follow: true,
    },
    // Search-console ownership tags — emitted only when the matching env
    // var is set (server-side, read at runtime). Set them in the prod
    // `.env` once each console hands you its token, then the <meta> shows
    // up and you click "verify". See .env.example.
    verification: buildVerification(),
  };
}

/** Site-verification `<meta>` tags for Google / Bing / Seznam.cz, each
 *  gated on its env token so nothing is emitted until it's configured. */
function buildVerification(): Metadata["verification"] {
  const google = process.env.GOOGLE_SITE_VERIFICATION;
  const other: Record<string, string> = {};
  if (process.env.SEZNAM_WMT) other["seznam-wmt"] = process.env.SEZNAM_WMT;
  if (process.env.BING_SITE_VERIFICATION) {
    other["msvalidate.01"] = process.env.BING_SITE_VERIFICATION;
  }
  return {
    ...(google ? { google } : {}),
    ...(Object.keys(other).length > 0 ? { other } : {}),
  };
}
