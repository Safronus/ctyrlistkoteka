import { Inter } from "next/font/google";
import { ThemeScript } from "@/components/theme-script";
import { DeployHealthScript } from "@/components/deploy-health-script";
import "@/app/globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

/**
 * The `<html>` shell shared by every root layout — `[locale]/layout.tsx`
 * (public site, lang from the URL) and the Czech-only sections outside it:
 * `admin/layout.tsx`, `d/layout.tsx`, `tym/layout.tsx`.
 *
 * Why several roots and no `app/layout.tsx`: `next/root-params` only sees
 * the params of a ROOT layout, and with a layout above `[locale]` the
 * locale is not a root param at all. One root per section, not a route
 * group: Next 16.4's type generator strips groups from layout paths, so a
 * `(group)/layout.tsx` counts as a layout at "/" — above `[locale]` again —
 * and `next/root-params` would get no `locale` export.
 * Navigating between two roots is a full page load — admin and the public
 * site are separate worlds anyway.
 *
 * overflow-x-clip on the root <html> is the viewport-level guard against
 * horizontal "floating" on mobile: it clips ANY stray horizontal overflow —
 * including position:fixed overlays and anything in the header/footer that
 * a clip on <main> can't reach. `clip` (not `hidden`) doesn't create a
 * scroll container, so the sticky header still sticks and vertical
 * scrolling is untouched (overflow-y visible).
 */
export function RootShell({
  lang,
  children,
}: {
  lang: string;
  children: React.ReactNode;
}) {
  return (
    <html
      lang={lang}
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
