import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale, NextIntlClientProvider } from "next-intl";

/**
 * Force this layout to render dynamically. Without this, Next.js
 * tries to generate a "segment prefetch shell" for pages below — and
 * because we read request-scoped data here (locale via next-intl,
 * anniversary dates from DB, watermark file metadata), the shell
 * generation fails with HTTP 500 on every link prefetch from the
 * client. Forcing dynamic skips the prefetch-shell pathway entirely;
 * actual page rendering performance stays unchanged because the
 * downstream pages (e.g. `/sbirka/[id]` with `revalidate = 86400`)
 * still cache their own RSC payloads.
 */
export const dynamic = "force-dynamic";
import Image from "next/image";
import { Github, Linkedin, Sparkles } from "lucide-react";
import {
  AbuseIpdbBadge,
  AbuseIpdbBadgeFallback,
} from "@/components/abuseipdb-badge";
import { AnniversaryOverlay } from "@/components/anniversary/anniversary-overlay";
import { MainNav } from "@/components/main-nav";
import { GoatCounterScript } from "@/components/visits/goatcounter-script";
import { VisitCounter } from "@/components/visits/visit-counter";
import { siteName } from "@/lib/siteName";
import { getAnniversaryDates } from "@/lib/queries/anniversaries";
import { getWatermarkMeta } from "@/lib/queries/watermark";
import { getCollectionFreshness } from "@/lib/queries/home";
import { CollectionFreshnessNote } from "@/components/home/collection-freshness-note";
import { formatShortDateTimeCs } from "@/lib/format";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";

/**
 * Public-pages layout — wraps `[locale]/page.tsx` and the public
 * sub-routes (sbirka, lokality, mapa, statistiky) with the chrome that
 * shouldn't appear on admin/API routes:
 *
 *  - `NextIntlClientProvider` exposes the active locale + messages to
 *    every client component beneath it (e.g. the navigation, language
 *    switcher, recharts wrappers).
 *  - `MainNav` / footer carry public-site branding.
 *  - `AnniversaryOverlay` only fires on public pages — admin doesn't
 *    need confetti when it's find #111's birthday.
 *  - `GoatCounterScript` pixel tracks public traffic only.
 */
export default async function PublicLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // Hand the locale to next-intl's request scope so server-rendered
  // children resolve `t('key')` against the right bundle and the
  // top-level <html lang> in the root layout matches what's rendered.
  setRequestLocale(locale);

  const [anniversaries, watermark, t, freshness] = await Promise.all([
    getAnniversaryDates(),
    getWatermarkMeta(),
    getTranslations("Footer"),
    getCollectionFreshness(),
  ]);

  return (
    <NextIntlClientProvider>
      <GoatCounterScript />
      <MainNav />
      {/* overflow-x-clip guards against the odd descendant (decorative
          off-canvas clovers, a wide embed) spilling past the viewport
          and letting the page pan sideways on mobile. `clip` (not
          `hidden`) doesn't create a scroll container, so the sticky
          header — a sibling, not a child — and inner `overflow-x-auto`
          tables / fixed modals all keep working. */}
      <main className="flex-1 overflow-x-clip">{children}</main>
      <AnniversaryOverlay
        anniversaries={anniversaries}
        watermarkSrc={watermark?.src ?? null}
      />
      <footer className="border-t border-gray-200 bg-gray-50 py-6">
        {locale === "en" && (
          <p className="mx-auto mb-2 max-w-7xl px-4 text-center text-xs italic text-gray-600 sm:px-6 lg:px-8">
            {t("mixedLanguageNote")}
          </p>
        )}
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-2 px-4 text-center text-sm text-gray-500 sm:px-6 lg:px-8">
          {/* 1 — copyright + author signature (smiley · Safronus · LinkedIn) */}
          <span className="inline-flex items-center gap-1.5">
            <span>
              {t("copyright", {
                year: new Date().getFullYear(),
                site: siteName(locale),
              })}
            </span>
            <Image
              src="/safronus.png"
              alt=""
              aria-hidden
              width={20}
              height={20}
              className="theme-invertible h-5 w-5"
            />
            <span className="font-medium text-gray-700">Safronus</span>
            <a
              href="https://www.linkedin.com/in/petr-žáček-9a2473b7/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("linkedinAria")}
              title={t("linkedinTitle")}
              className="rounded p-1 text-gray-500 transition hover:bg-gray-100 hover:text-brand-700"
            >
              <Linkedin className="h-4 w-4" aria-hidden />
            </a>
          </span>
          <span aria-hidden>·</span>
          {/* 2 — privacy policy (replaces the old "private collection" tagline) */}
          <Link
            href="/soukromi"
            className="text-gray-500 underline-offset-2 transition hover:text-brand-700 hover:underline"
          >
            {t("privacy")}
          </Link>
          <span aria-hidden>·</span>
          {/* 3 — built with Claude Code (no model names) · source · build number */}
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-amber-500" aria-hidden />
            <span>{t("withAssistance")}</span>
            <a
              href="https://claude.com/claude-code"
              target="_blank"
              rel="noopener noreferrer"
              title={t("claudeCodeTitle")}
              className="font-medium text-gray-700 underline-offset-2 hover:text-brand-700 hover:underline"
            >
              Claude Code
            </a>
            <a
              href="https://github.com/Safronus/ctyrlistkoteka"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("githubAria")}
              title={t("githubTitle")}
              className="rounded p-1 text-gray-500 transition hover:bg-gray-100 hover:text-brand-700"
            >
              <Github className="h-4 w-4" aria-hidden />
            </a>
            {process.env.NEXT_PUBLIC_COMMIT_COUNT && (
              <span
                className="font-mono text-xs text-gray-600"
                title={t("commitCountTitle")}
              >
                #{process.env.NEXT_PUBLIC_COMMIT_COUNT}
              </span>
            )}
          </span>
          <span aria-hidden>·</span>
          {/* 4 — AbuseIPDB contribution (server-fetched count, no visitor
              data leaves; Suspense so the external fetch never blocks render) */}
          <Suspense fallback={<AbuseIpdbBadgeFallback />}>
            <AbuseIpdbBadge />
          </Suspense>
          <span aria-hidden>·</span>
          {/* 5 — visit counter */}
          <VisitCounter />
        </div>
        {/* Second row — collection freshness ("Poslední aktualizace sbírky"
            + ⓘ founding / last backfill). Moved here from the home hero so it
            rides every page's footer. Dates are formatted server-side
            (formatShortDateTimeCs isn't TZ-pinned, so formatting client-side
            would risk a hydration mismatch). */}
        {(freshness.latestCreatedAt || freshness.firstCreatedAt) && (
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <CollectionFreshnessNote
              lastUpdated={
                freshness.latestCreatedAt
                  ? formatShortDateTimeCs(
                      new Date(freshness.latestCreatedAt),
                      locale,
                    )
                  : null
              }
              latestCount={freshness.latestFoundCount}
              firstFound={
                freshness.firstCreatedAt
                  ? formatShortDateTimeCs(
                      new Date(freshness.firstCreatedAt),
                      locale,
                    )
                  : null
              }
              lastBackfill={
                freshness.lastBackfillCreatedAt
                  ? formatShortDateTimeCs(
                      new Date(freshness.lastBackfillCreatedAt),
                      locale,
                    )
                  : null
              }
              backfillCount={freshness.lastBackfillCount}
            />
          </div>
        )}
      </footer>
    </NextIntlClientProvider>
  );
}

/**
 * Pre-render both locales' shells at build time — small fixed set, so
 * `generateStaticParams` is cheap and unblocks ISR for the underlying
 * pages.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}
