import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { getLocale } from "next-intl/server";
import { ThemeScript } from "@/components/theme-script";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/constants";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    template: `%s · ${SITE_NAME}`,
    default: SITE_NAME,
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  icons: {
    icon: [
      { url: "/clover.png", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
  },
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
  },
};

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
  return (
    <html lang={locale} className={inter.variable} data-theme="clover">
      <body className="flex min-h-screen flex-col">
        <ThemeScript />
        {children}
      </body>
    </html>
  );
}
