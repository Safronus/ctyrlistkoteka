import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import Image from "next/image";
import { Github, Linkedin, Sparkles } from "lucide-react";
import { AnniversaryOverlay } from "@/components/anniversary/anniversary-overlay";
import { MainNav } from "@/components/main-nav";
import { GoatCounterScript } from "@/components/visits/goatcounter-script";
import { VisitCounter } from "@/components/visits/visit-counter";
import { SITE_NAME } from "@/lib/constants";
import { getAnniversaryDates } from "@/lib/queries/anniversaries";
import { getWatermarkMeta } from "@/lib/queries/watermark";
import { routing } from "@/i18n/routing";

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

  const [anniversaries, watermark] = await Promise.all([
    getAnniversaryDates(),
    getWatermarkMeta(),
  ]);

  return (
    <NextIntlClientProvider>
      <GoatCounterScript />
      <MainNav />
      <main className="flex-1">{children}</main>
      <AnniversaryOverlay
        anniversaries={anniversaries}
        watermarkSrc={watermark?.src ?? null}
      />
      <footer className="border-t border-gray-200 bg-gray-50 py-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-2 px-4 text-center text-sm text-gray-500 sm:px-6 lg:px-8">
          <span>
            © {new Date().getFullYear()} {SITE_NAME} · Soukromá sbírka
            čtyřlístků
          </span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1.5">
            vytvořil
            <Image
              src="/safronus.png"
              alt=""
              aria-hidden
              width={20}
              height={20}
              className="theme-invertible h-5 w-5"
            />
            <span className="font-medium text-gray-700">Safronus</span>
            {/* The LinkedIn slug carries Czech diacritics — JSX/React
                serialises the href verbatim and the browser
                percent-encodes on navigation, so leaving the literal
                characters in is fine and most readable in source. */}
            <a
              href="https://www.linkedin.com/in/petr-žáček-9a2473b7/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="LinkedIn profil autora"
              title="LinkedIn"
              className="ml-1 rounded p-1 text-gray-500 transition hover:bg-gray-100 hover:text-brand-700"
            >
              <Linkedin className="h-4 w-4" aria-hidden />
            </a>
            <a
              href="https://github.com/Safronus/ctyrlistkoteka"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Zdrojový kód aplikace na GitHubu"
              title="Zdrojový kód na GitHubu"
              className="rounded p-1 text-gray-500 transition hover:bg-gray-100 hover:text-brand-700"
            >
              <Github className="h-4 w-4" aria-hidden />
            </a>
          </span>
          <span aria-hidden>·</span>
          {/* AI-assistance credit. Sparkles icon nods at the "AI"
              flavour without being too cute; both anchors open in
              a new tab so the visitor can read up on Anthropic /
              Claude Code without losing their place here. */}
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-amber-500" aria-hidden />
            <span>s asistencí</span>
            <a
              href="https://www.anthropic.com/claude"
              target="_blank"
              rel="noopener noreferrer"
              title="Claude od Anthropic"
              className="font-medium text-gray-700 underline-offset-2 hover:text-brand-700 hover:underline"
            >
              Claude Opus 4.7
            </a>
            <span className="text-gray-400">přes</span>
            <a
              href="https://claude.com/claude-code"
              target="_blank"
              rel="noopener noreferrer"
              title="Claude Code"
              className="font-medium text-gray-700 underline-offset-2 hover:text-brand-700 hover:underline"
            >
              Claude Code
            </a>
          </span>
          <span aria-hidden>·</span>
          <VisitCounter />
        </div>
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
