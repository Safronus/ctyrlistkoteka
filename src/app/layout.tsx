import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { getLocale } from "next-intl/server";
import { ThemeScript } from "@/components/theme-script";
import { DeployHealthScript } from "@/components/deploy-health-script";
import { SITE_DESCRIPTION } from "@/lib/constants";
import { siteName } from "@/lib/siteName";
import { siteBaseUrl } from "@/lib/seo";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

// Locale-aware so the document <title> template and OpenGraph title carry
// the English wordmark ("Safron's Luckographer") on /en pages and the
// Czech one elsewhere. getLocale() resolves the request locale (defaults
// to Czech on non-localized routes like /admin).
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
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

/**
 * Minimal root layout — just the `<html>` shell plus universal scripts.
 *
 * The full public chrome (MainNav, footer, AnniversaryOverlay,
 * GoatCounter pixel) lives in `[locale]/layout.tsx` so it picks up the
 * route's locale automatically. Admin and API routes don't need any of
 * that and stay pristine.
 *
 * `<html lang>` is locale-aware via `getLocale()` from next-intl —
 * falls back to `cs` (defaultLocale) for routes outside `[locale]`
 * (admin, API), which is what we want since admin is Czech-only.
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  // overflow-x-clip on the root <html> is the viewport-level guard
  // against horizontal "floating" on mobile: it clips ANY stray
  // horizontal overflow — including position:fixed overlays and anything
  // in the header/footer that a clip on <main> can't reach. `clip` (not
  // `hidden`) doesn't create a scroll container, so the sticky header
  // still sticks and vertical scrolling is untouched (overflow-y visible).
  return (
    <html
      lang={locale}
      className={`${inter.variable} overflow-x-clip`}
      data-theme="clover"
    >
      <body className="flex min-h-screen flex-col">
        <ThemeScript />
        <DeployHealthScript />
        {children}
      </body>
    </html>
  );
}
