import Image from "next/image";
import {
  BarChart3,
  Building2,
  CalendarRange,
  Clover,
  ExternalLink,
  Globe,
  Images,
  ListIcon,
  Map as MapIcon,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { FindState } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import { localePath, ogLocale, seoAlternates } from "@/lib/seo";
import { JsonLd } from "@/components/seo/json-ld";
import { websiteSchema } from "@/lib/schema";
import { Link } from "@/i18n/navigation";
import { getHomePageData, type HomePageData } from "@/lib/queries/home";
import { getRandomFindShowcase } from "@/lib/queries/random-find";
import { getHomeRotationSettings } from "@/lib/homeRotation.server";
import { getRetrospective } from "@/lib/queries/retrospective";
import { getWatermarkMeta } from "@/lib/queries/watermark";
import {
  formatDateCs,
  formatDateTimeCs,
  formatShortDateTimeCs,
  locationDetailHref,
} from "@/lib/format";
import { siteName, siteNameShort } from "@/lib/siteName";
import { ImageGallery } from "@/components/finds/image-gallery";
import { GpsValue } from "@/components/finds/gps-value";
import { RandomFindShowcaseWidget } from "@/components/finds/random-find-showcase";
import { StateBadges } from "@/components/finds/state-badges";
import { VoteButton } from "@/components/finds/vote-button";
import { CloverFactCard } from "@/components/home/clover-fact-card";
import { CollectionFreshnessNote } from "@/components/home/collection-freshness-note";
import { CloverFactsStatCard } from "@/components/home/clover-facts-stat-card";
import { PopularFindWidget } from "@/components/home/popular-find-widget";
import { getTopFindsWithThumbs } from "@/lib/votes";
import { DonatedSearchCatcher } from "@/components/home/donated-search-catcher";
import { RetrospectiveGrid } from "@/components/home/retrospective-grid";
import { DisclaimerSection } from "@/components/home/disclaimer-section";
import { DonatedBoardSection } from "@/components/home/donated-board";
import {
  getCloverTexts,
  getCloverTranslations,
} from "@/lib/cloverTextsServer";
import type { CloverEnEntry, CloverText } from "@/lib/cloverTexts";

type HomeT = Awaited<ReturnType<typeof getTranslations<"Home">>>;

// Must be a literal for Next.js static analysis. Matches HOME_REVALIDATE in
// src/lib/constants.ts (1 hour).
export const revalidate = 3600;

function toIntlLocale(locale: string): string {
  if (locale === "cs") return "cs-CZ";
  if (locale === "en") return "en-GB";
  return locale;
}

export async function generateMetadata(): Promise<Metadata> {
  // Title + description are inherited from the root layout (site name +
  // SITE_DESCRIPTION); here we only add canonical/hreflang + the brand OG
  // card. Next fills og:title/description from the inherited title/desc.
  const locale = await getLocale();
  return {
    alternates: seoAlternates("/", locale),
    openGraph: {
      locale: ogLocale(locale),
      url: localePath("/", locale),
      images: [{ url: "/og", width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", images: ["/og"] },
  };
}

export default async function HomePage() {
  const locale = await getLocale();
  const t = await getTranslations("Home");
  const intlLocale = toIntlLocale(locale);
  const NF = new Intl.NumberFormat(intlLocale);
  const [
    data,
    watermark,
    randomFind,
    retrospective,
    cloverTexts,
    cloverTranslations,
    popularTop,
    rotation,
  ] = await Promise.all([
    getHomePageData(),
    getWatermarkMeta(),
    getRandomFindShowcase(),
    getRetrospective(),
    getCloverTexts(),
    getCloverTranslations(),
    // Top 3 across all-time — homepage "Nejoblíbenější čtyřlístek"
    // tile shows the winner big plus 2nd/3rd as compact links. Renders
    // nothing on an empty vote table.
    getTopFindsWithThumbs({ limit: 3 }),
    // Admin-tunable rotation intervals (seconds) for the three rotating
    // surfaces — passed down to the client widgets as ms.
    getHomeRotationSettings(),
  ]);
  const popularWinner = popularTop[0] ?? null;
  const popularRunnersUp = popularTop.slice(1);
  const { totals, highlights } = data;

  // Ship only a small random seed of clover facts in the initial HTML; the
  // CloverFactCard pulls the full ~210-entry set from /api/clover-facts once
  // it hydrates. This keeps the whole collection out of every homepage
  // SSR/RSC payload — the single biggest chunk of the page's HTML weight.
  const CLOVER_SEED_COUNT = 8;
  const cloverSeed: CloverText[] = (() => {
    if (cloverTexts.length <= CLOVER_SEED_COUNT) return [...cloverTexts];
    const pool = [...cloverTexts];
    const out: CloverText[] = [];
    for (let i = 0; i < CLOVER_SEED_COUNT && pool.length > 0; i++) {
      out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!);
    }
    return out;
  })();
  const cloverSeedTranslations: Record<string, CloverEnEntry> = {};
  for (const seed of cloverSeed) {
    const key = String(seed.id);
    const tr = cloverTranslations[key];
    if (tr) cloverSeedTranslations[key] = tr;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <JsonLd data={websiteSchema(siteName(locale), locale)} />
      {/* Hero, three-tier composition:
          1. Title centered across the full width.
          2. Trio row — clover logo · pinned-paper fact · watermark
             smiley — flexed in a centered row on lg+, stacked on
             smaller screens (paper card sits between the two brand
             marks, balanced on each side).
          3. Intro paragraph + "naposledy doplněno" line, centered. */}
      <section>
        <h1 className="ctyr-hero-title text-center text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
          {siteNameShort(locale)}
        </h1>

        <div className="mt-6 flex flex-col items-center justify-center gap-4 sm:gap-5 lg:flex-row">
          <Image
            src="/clover.png"
            alt=""
            aria-hidden
            width={256}
            height={256}
            priority
            className="hidden shrink-0 lg:-mr-2 lg:block lg:h-32 lg:w-32"
          />
          <div className="relative">
            <CloverFactCard
              texts={cloverSeed}
              translations={cloverSeedTranslations}
              rotationMs={rotation.cloverFactSeconds * 1000}
            />
            <Image
              src="/clover.png"
              alt=""
              aria-hidden
              width={128}
              height={128}
              priority
              className="absolute -left-4 -top-4 z-10 h-14 w-14 -rotate-12 lg:hidden"
            />
            {watermark && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={watermark.src}
                alt=""
                aria-hidden
                className="theme-invertible absolute -bottom-7 -left-4 z-10 h-14 w-14 rotate-[15deg] object-contain opacity-70 lg:hidden"
              />
            )}
          </div>
          {watermark ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={watermark.src}
              alt=""
              aria-hidden
              width={watermark.width}
              height={watermark.height}
              className="theme-invertible hidden w-auto shrink-0 rotate-[15deg] opacity-70 lg:block lg:h-32"
            />
          ) : (
            <div className="hidden lg:block lg:h-32 lg:w-32 lg:shrink-0" />
          )}
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-base text-gray-600 sm:text-lg">
          {t("intro")}
        </p>
        {(totals.latestCreatedAt || highlights.firstCreatedAt) && (
          // One compact "last updated (+N)" line; the ⓘ toggle reveals the
          // founding date + last historic backfill. "Backfill" = an upload of
          // older finds filling gaps in the historic ID range; we surface its
          // created_at (DB insert, not EXIF date). Dates are formatted here
          // (server-side) because formatShortDateTimeCs isn't TZ-pinned.
          <CollectionFreshnessNote
            lastUpdated={
              totals.latestCreatedAt
                ? formatShortDateTimeCs(new Date(totals.latestCreatedAt), locale)
                : null
            }
            latestCount={totals.latestFoundCount}
            firstFound={
              highlights.firstCreatedAt
                ? formatShortDateTimeCs(
                    new Date(highlights.firstCreatedAt),
                    locale,
                  )
                : null
            }
            lastBackfill={
              totals.lastBackfillCreatedAt
                ? formatShortDateTimeCs(
                    new Date(totals.lastBackfillCreatedAt),
                    locale,
                  )
                : null
            }
            backfillCount={totals.lastBackfillCount}
          />
        )}
      </section>

      <DonatedShowcase
        count={totals.donated}
        lastDonated={
          totals.lastDonatedAt
            ? formatShortDateTimeCs(new Date(totals.lastDonatedAt), locale)
            : null
        }
        t={t}
        nf={NF}
      />

      <section className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <NavCard
          href="/sbirka"
          title={t("navSbirkaTitle")}
          description={t("navSbirkaDesc")}
          icon={Images}
        />
        <NavCard
          href="/lokality"
          title={t("navLokalityTitle")}
          description={t("navLokalityDesc")}
          icon={MapPin}
        />
        <NavCard
          href="/mapa"
          title={t("navMapaTitle")}
          description={t("navMapaDesc")}
          icon={MapIcon}
        />
        <NavCard
          href="/statistiky"
          title={t("navStatistikyTitle")}
          description={t("navStatistikyDesc")}
          icon={BarChart3}
        />
      </section>

      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          value={
            totals.maxFindId !== null ? NF.format(totals.maxFindId) : "—"
          }
          // Two lines: the big find count, then "nálezů" with the uploaded
          // count in parentheses. The parenthetical only shows when there's
          // a backfill gap (maxFindId ≠ uploaded) — when they match it would
          // just repeat the headline number.
          label={
            totals.maxFindId !== null && totals.maxFindId !== totals.finds
              ? `${t("statFinds", { count: totals.maxFindId })} (${t("statFindsUploadedHint", { count: totals.finds })})`
              : t("statFinds", { count: totals.maxFindId ?? totals.finds })
          }
          icon={Clover}
        />
        <StatCard
          value={NF.format(totals.locations)}
          label={t("statLocations", { count: totals.locations })}
          icon={MapPin}
        />
        <StatCard
          value={NF.format(totals.cities)}
          label={t("statCities", { count: totals.cities })}
          icon={Building2}
        />
        <StatCard
          value={NF.format(totals.countries)}
          label={t("statCountries", { count: totals.countries })}
          icon={Globe}
        />
        <StatCard
          value={totals.yearsSpan ? String(totals.yearsSpan) : "—"}
          label={t("statYears", { count: totals.yearsSpan ?? 0 })}
          icon={CalendarRange}
        />
      </section>

      <HighlightsSection
        highlights={data.highlights}
        recentMonthly={data.recentMonthly}
        t={t}
        locale={locale}
        nf={NF}
        cloverTexts={cloverTexts}
      />

      {/* Popular pick sits below "Zajímavosti" — community spotlight
       *  follows the editorial highlights. Hides itself when no votes
       *  exist yet, so the cold-start page doesn't show a placeholder. */}
      <PopularFindWidget winner={popularWinner} runnersUp={popularRunnersUp} />

      {data.latestFind && (
        <FirstVsLatestSection
          firstFind={data.firstFind}
          latestFind={data.latestFind}
          t={t}
          locale={locale}
        />
      )}

      <RandomFindShowcaseWidget
        initial={randomFind}
        rotationMs={rotation.randomFindSeconds * 1000}
        screensaverMs={rotation.screensaverSeconds * 1000}
      />

      {/* Retrospective last — it's a heavy "look-back" section that
       *  belongs at the bottom of the page, after the visitor has
       *  seen the current state of the collection. */}
      {retrospective && <RetrospectiveGrid data={retrospective} />}

      {/* Closing apology + "luck is free" offer. */}
      <DisclaimerSection />

      {/* Field of clovers that have already been given away on the back
          of the apology's offer. Renders nothing when the admin list is
          empty. */}
      <DonatedBoardSection />
    </div>
  );
}

function DonatedShowcase({
  count,
  lastDonated,
  t,
  nf,
}: {
  count: number;
  /** Pre-formatted date+time the most recent donated find reached the
   *  catalog (server-formatted, Europe/Prague). Null when none donated. */
  lastDonated: string | null;
  t: HomeT;
  nf: Intl.NumberFormat;
}) {
  const DRIFTERS = 16;
  const LOOP_S = 8;

  // mt-6 instead of mt-12 — the hero already has generous bottom
  // breathing room from its own typography, so a half-rem gap here
  // keeps the "Komu už putovalo štěstí" line related to the totals
  // it interprets, rather than feeling like a separate landing zone.
  return (
    <section className="mt-6 text-center">
      <style>{`
        @keyframes ctyr-drift {
          0%   { transform: translate(82px, var(--y0)) rotate(0deg)  scale(0.7);  opacity: 0; }
          12%  { opacity: 0.95; }
          70%  { opacity: 0.55; }
          100% { transform: translate(540px, calc(var(--y0) - 10px)) rotate(45deg) scale(0.5); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ctyr-drifter {
            animation-play-state: paused !important;
          }
        }
      `}</style>

      <p className="text-base text-gray-700 sm:text-lg">
        {t("donatedPrefix")}{" "}
        <Link
          href="/sbirka?state=DONATED"
          className="relative inline-block transition-transform hover:scale-[1.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 rounded-sm"
          aria-label={t("donatedAria", { count: nf.format(count) })}
        >
          <span className="text-2xl font-bold text-brand-700 hover:text-brand-800 sm:text-3xl">
            {nf.format(count)}
          </span>
          <svg
            viewBox="0 0 80 8"
            preserveAspectRatio="none"
            className="absolute -bottom-1.5 left-0 h-2 w-full text-brand-600"
            aria-hidden
          >
            <path
              d="M1 5 Q 10 1, 20 4 T 40 4 T 60 4 T 79 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </Link>{" "}
        {t("donatedSuffix", { count })}
      </p>

      {lastDonated && (
        <p className="mt-1 text-xs text-gray-500">
          {t("donatedLast")}{" "}
          <span className="text-gray-600">{lastDonated}</span>
        </p>
      )}

      {/* viewBox cropped to 600×72 from the original 600×110 — the
          STATIC_CLUSTER + drifters sit at y≈30–66, so the lower ~40
          units of the viewBox were rendering as empty whitespace that
          translated into visible padding on the page. Container
          height shrunk to h-20/sm:h-24 to match the tighter content. */}
      <svg
        viewBox="0 5 600 72"
        preserveAspectRatio="xMidYMid meet"
        className="mx-auto mt-1.5 h-20 w-full max-w-2xl sm:h-24"
        aria-hidden
      >
        {STATIC_CLUSTER.map((c, i) => (
          <g
            key={`s${i}`}
            transform={`translate(${c.x} ${c.y}) scale(${c.s})`}
            opacity={c.o}
          >
            <CloverShape />
          </g>
        ))}

        {Array.from({ length: DRIFTERS }, (_, i) => {
          const yJitter = (i * 17) % 28 - 14;
          const delay = -((i / DRIFTERS) * LOOP_S);
          return (
            <g
              key={`d${i}`}
              className="ctyr-drifter"
              style={
                {
                  animation: `ctyr-drift ${LOOP_S}s linear infinite`,
                  animationDelay: `${delay.toFixed(2)}s`,
                  transformOrigin: "center",
                  transformBox: "fill-box",
                  "--y0": `${52 + yJitter}px`,
                } as React.CSSProperties
              }
            >
              <CloverShape />
            </g>
          );
        })}
      </svg>

      <DonatedSearchCatcher />
    </section>
  );
}

function CloverShape() {
  return (
    <g fill="#15803d">
      <circle cx={0} cy={-5} r={4} />
      <circle cx={-5} cy={0} r={4} />
      <circle cx={5} cy={0} r={4} />
      <circle cx={0} cy={5} r={4} />
      <circle cx={0} cy={0} r={2.5} fill="#0f6e34" />
    </g>
  );
}

const STATIC_CLUSTER: ReadonlyArray<{
  x: number;
  y: number;
  s: number;
  o: number;
}> = [
  { x: 82, y: 52, s: 1.0, o: 1.0 },
  { x: 70, y: 58, s: 0.85, o: 0.95 },
  { x: 92, y: 46, s: 0.8, o: 0.9 },
  { x: 76, y: 42, s: 0.7, o: 0.85 },
  { x: 96, y: 62, s: 0.82, o: 0.95 },
  { x: 65, y: 48, s: 0.65, o: 0.8 },
];

function StatCard({
  value,
  label,
  icon: Icon,
  hint,
}: {
  value: string;
  label: string;
  /** Lucide icon pinned to the top-right, matching the NavCard
   *  pattern above. Color sits at brand-500 — readable against the
   *  brand-50 background but muted enough that the big numeric
   *  value (brand-700) stays the focal point. No hover state: the
   *  card isn't interactive, the icon is a static visual cue for
   *  "this stat is about X". */
  icon: LucideIcon;
  /** Optional small line of muted text below the label — used on
   *  the finds tile to surface the "<count> nahraných" qualifier
   *  under the headline max-find-id. Card collapses gracefully
   *  when omitted (legacy behaviour for the other tiles). */
  hint?: string;
}) {
  return (
    <div className="relative rounded-xl border border-gray-200 bg-brand-50 p-4 text-center">
      <Icon
        className="absolute right-3 top-3 h-4 w-4 text-brand-500"
        aria-hidden
      />
      <p className="text-2xl font-bold text-brand-700 sm:text-3xl">{value}</p>
      <p className="mt-1 text-xs text-gray-600 sm:text-sm">{label}</p>
      {hint && (
        <p className="mt-0.5 text-[11px] text-gray-700">{hint}</p>
      )}
    </div>
  );
}

function NavCard({
  href,
  title,
  description,
  icon: Icon,
}: {
  href: string;
  title: string;
  description: string;
  /** Lucide icon component rendered in the top-right corner — gives
   *  each destination an at-a-glance affordance. The clover-theme
   *  `bg-gray-50` background reads as faint mint green, matching the
   *  PaceCell tiles on /statistiky so the home page nav feels like
   *  the same family of surfaces rather than plain white buttons. */
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className="group relative rounded-xl border border-gray-200 bg-gray-50 p-5 transition hover:border-brand-200 hover:bg-brand-50/40 hover:shadow-sm"
    >
      <Icon
        className="absolute right-4 top-4 h-5 w-5 text-gray-400 transition group-hover:text-brand-600"
        aria-hidden
      />
      {/* Centred title — the short nav labels (Sbírka, Lokality, Mapa,
          Statistiky) never reach the small top-right icon, so no
          right-padding reservation is needed. */}
      <h2 className="text-center text-lg font-semibold text-gray-900 group-hover:text-brand-700">
        {title}
      </h2>
      <p className="mt-1 pr-2 text-sm text-gray-600">{description}</p>
    </Link>
  );
}

function FirstVsLatestSection({
  firstFind,
  latestFind,
  t,
  locale,
}: {
  firstFind: HomePageData["firstFind"];
  latestFind: NonNullable<HomePageData["latestFind"]>;
  t: HomeT;
  locale: string;
}) {
  // With a single-find collection first === latest — show just one
  // centered column so the same clover doesn't appear twice. The inline
  // null-check also narrows the type.
  const showBoth = firstFind && firstFind.id !== latestFind.id;
  return (
    <section className="mt-8">
      {showBoth ? (
        // Two find photos side by side, filling the page width with a gap
        // between them; they stack on phones.
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-8">
          <FindPhotoColumn find={firstFind} t={t} locale={locale} />
          <FindPhotoColumn find={latestFind} t={t} locale={locale} />
        </div>
      ) : (
        <div className="mx-auto max-w-lg">
          <FindPhotoColumn find={latestFind} t={t} locale={locale} />
        </div>
      )}
    </section>
  );
}

async function FindPhotoColumn({
  find,
  t,
  locale,
}: {
  find: NonNullable<HomePageData["latestFind"]>;
  t: HomeT;
  locale: string;
}) {
  const tRow = await getTranslations("FindRow");
  const altText = find.isAnonymized
    ? tRow("anonymizedAlt", { id: find.id })
    : tRow("findAlt", { id: find.id });
  const foundAtDate = find.foundAt ? new Date(find.foundAt) : null;
  // Lost finds get the desaturated treatment used on the detail page and
  // the random showcase; the map deep-link + GPS are suppressed for
  // anonymized finds (their exact position must never leak).
  const isLost = find.states.includes(FindState.LOST);
  const hasMapPosition = !find.isAnonymized && find.coordinates !== null;

  return (
    <div>
      {/* Clickable heading → detail, sized + centered like the random
          showcase's "Náhodný 🍀 #id". "🍀 #1" on the left (oldest find),
          "🍀 #<max>" on the right (newest). */}
      <div className="mb-2 text-center">
        <Link
          href={`/sbirka/${find.id}`}
          className="text-2xl font-bold text-gray-900 transition hover:text-brand-700"
        >
          🍀 #{find.id}
        </Link>
      </div>
      {/* No frame — the photo fills its grid column. All chrome (map,
          vote, states, date, GPS, lupa) rides on the photo as overlays,
          mirroring the "Náhodný 🍀" showcase. No height cap so the photo
          fills the column; landscapes rotate 90° CW to portrait. No
          location info, per the home layout. */}
      <ImageGallery
        image={find.primaryImage}
        cropImage={find.cropImage}
        altBase={altText}
        findId={find.id}
        muted={isLost}
        maxVh={null}
        rotateLandscape
        mapSlot={
          hasMapPosition ? (
            <Link
              href={`/mapa?find=${find.id}`}
              aria-label={t("latestFindShowOnMap")}
              title={t("latestFindShowOnMap")}
              className="inline-flex items-center justify-center rounded-full bg-white/90 p-2 text-brand-700 shadow-md ring-1 ring-black/5 backdrop-blur transition hover:bg-white hover:text-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <MapPin className="h-5 w-5" aria-hidden />
            </Link>
          ) : null
        }
        voteSlot={
          <VoteButton
            findId={find.id}
            initialVoted={false}
            initialCount={0}
            variant="overlay"
            autoHydrate
          />
        }
        statesSlot={
          find.states.length > 0 ? <StateBadges states={find.states} /> : null
        }
        dateSlot={
          foundAtDate ? (
            <span className="rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-brand-700 shadow-md ring-1 ring-black/5 backdrop-blur">
              {formatDateTimeCs(foundAtDate, locale, "Europe/Prague")}
            </span>
          ) : null
        }
        gpsSlot={
          hasMapPosition && find.coordinates ? (
            <div className="rounded-md bg-white/90 px-2 py-1 shadow-md ring-1 ring-black/5 backdrop-blur">
              <GpsValue
                lat={find.coordinates.lat}
                lng={find.coordinates.lng}
                tone="brand"
              />
            </div>
          ) : null
        }
      />
    </div>
  );
}

function HighlightsSection({
  highlights,
  recentMonthly,
  t,
  locale,
  nf,
  cloverTexts,
}: {
  highlights: HomePageData["highlights"];
  recentMonthly: HomePageData["recentMonthly"];
  t: HomeT;
  locale: string;
  nf: Intl.NumberFormat;
  cloverTexts: ReadonlyArray<CloverText>;
}) {
  const peakDay = highlights.peakDay;
  const top = highlights.topLocation;
  const distinctCategoryKeys = Array.from(
    new Set(cloverTexts.map((c) => c.category)),
  );

  return (
    <section className="mt-8">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CloverFactsStatCard
          total={cloverTexts.length}
          bonus={cloverTexts.filter((c) => c.author === true).length}
          categoryKeys={distinctCategoryKeys}
        />
        {peakDay ? (
          <PeakDayCard peakDay={peakDay} t={t} locale={locale} nf={nf} />
        ) : (
          <HighlightCard label={t("peakDayLabel")} value="—" hint={null} />
        )}
        {top ? (
          <TopLocationCard location={top} t={t} nf={nf} />
        ) : (
          <HighlightCard label={t("topLocationLabel")} value="—" hint={null} />
        )}
        <SparklineCard data={recentMonthly} t={t} locale={locale} nf={nf} />
      </div>
    </section>
  );
}

function TopLocationCard({
  location,
  t,
  nf,
}: {
  location: NonNullable<HomePageData["highlights"]["topLocation"]>;
  t: HomeT;
  nf: Intl.NumberFormat;
}) {
  const netLabel = formatDurationMinutes(location.netMinutes);
  return (
    <div className="relative flex flex-col rounded-xl border border-gray-200 bg-white p-3 text-center">
      <Link
        href={locationDetailHref(location.id)}
        aria-label={t("topLocationDetail")}
        title={t("topLocationDetail")}
        className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition hover:bg-brand-50 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500"
      >
        <ExternalLink className="h-4 w-4" aria-hidden />
      </Link>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {t("topLocationLabel")}
      </p>
      <p
        className="mt-1 truncate pr-8 text-base font-semibold text-gray-900"
        title={location.code}
      >
        {location.code}
      </p>
      <p className="mt-0.5 text-xs text-gray-500">
        {nf.format(location.count)} {t("statFinds", { count: location.count })}
      </p>
      {netLabel && (
        <div className="flex flex-1 flex-col items-center justify-center py-1.5 text-center">
          <p
            className="font-mono text-base font-semibold tabular-nums text-gray-900"
            title={t("netTimeTitleLocation")}
          >
            {netLabel}
          </p>
          <p className="text-[11px] leading-tight text-gray-500">
            {t("netTimeLabel")}
          </p>
          {location.netMinutes > 0 && (
            <p
              className="mt-0.5 font-mono text-[11px] leading-tight tabular-nums text-gray-500"
              title={t("netTimeRateTitleLocation")}
            >
              {new Intl.NumberFormat(nf.resolvedOptions().locale, {
                maximumFractionDigits: 1,
              }).format(location.count / location.netMinutes)}{" "}
              {t("netTimeRateUnit")}
            </p>
          )}
        </div>
      )}
      <div className="mt-auto flex flex-col gap-1.5 pt-2">
        <Link
          href={`/sbirka?loc=${location.id}`}
          className="flex w-full items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          <ListIcon className="h-3.5 w-3.5" aria-hidden />
          <span>{t("topLocationShowFinds")}</span>
        </Link>
        <Link
          href={`/mapa?focus=${location.id}`}
          className="flex w-full items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          <span>{t("topLocationShowOnMap")}</span>
        </Link>
      </div>
    </div>
  );
}

function PeakDayCard({
  peakDay,
  t,
  locale,
  nf,
}: {
  peakDay: NonNullable<HomePageData["highlights"]["peakDay"]>;
  t: HomeT;
  locale: string;
  nf: Intl.NumberFormat;
}) {
  const date = new Date(peakDay.startsAt);
  const firstAt = new Date(peakDay.firstAt);
  const lastAt = new Date(peakDay.lastAt);
  const isoDay = date.toISOString().slice(0, 10);
  const intlLocale = nf.resolvedOptions().locale;
  // No `timeZone`: found_at is the naive Prague wall-clock from EXIF and is
  // shown verbatim everywhere else; forcing Europe/Prague double-applied
  // the +2h offset on the UTC server.
  const timeFmt = new Intl.DateTimeFormat(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const fromTo = `${timeFmt.format(firstAt)}–${timeFmt.format(lastAt)}`;
  const durationMin = Math.max(
    0,
    Math.round((lastAt.getTime() - firstAt.getTime()) / 60_000),
  );
  const durationLabel = formatDurationMinutes(durationMin);
  const netLabel = formatDurationMinutes(peakDay.netMinutes);
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-3 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {t("peakDayLabel")}
      </p>
      <p className="mt-1 truncate text-base font-semibold text-gray-900">
        {nf.format(peakDay.count)} {t("statFinds", { count: peakDay.count })}
      </p>
      <p className="mt-0.5 text-xs text-gray-500">
        {formatDateCs(date, locale)}
      </p>
      <p className="mt-0.5 text-xs text-gray-500">
        <span className="font-mono tabular-nums">{fromTo}</span>
        {durationLabel && (
          <>
            {" · "}
            <span title={t("peakDayDuration")}>{durationLabel}</span>
          </>
        )}
      </p>
      {netLabel && (
        <div className="flex flex-1 flex-col items-center justify-center py-1.5 text-center">
          <p
            className="font-mono text-base font-semibold tabular-nums text-gray-900"
            title={t("netTimeTitleDay")}
          >
            {netLabel}
          </p>
          <p className="text-[11px] leading-tight text-gray-500">
            {t("netTimeLabel")}
          </p>
          {peakDay.netMinutes > 0 && (
            <p
              className="mt-0.5 font-mono text-[11px] leading-tight tabular-nums text-gray-500"
              title={t("netTimeRateTitle")}
            >
              {new Intl.NumberFormat(intlLocale, {
                maximumFractionDigits: 1,
              }).format(peakDay.count / peakDay.netMinutes)}{" "}
              {t("netTimeRateUnit")}
            </p>
          )}
        </div>
      )}
      <div className="mt-auto flex flex-col gap-1.5 pt-2">
        <Link
          href={`/sbirka?from=${isoDay}&to=${isoDay}`}
          className="flex w-full items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          <ListIcon className="h-3.5 w-3.5" aria-hidden />
          <span>{t("peakDayShowFinds")}</span>
        </Link>
      </div>
    </div>
  );
}

function formatDurationMinutes(total: number): string | null {
  if (total <= 0) return null;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function HighlightCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string | null;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-1 truncate text-base font-semibold text-gray-900">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

async function SparklineCard({
  data,
  t,
  locale,
  nf,
}: {
  data: HomePageData["recentMonthly"];
  t: HomeT;
  locale: string;
  nf: Intl.NumberFormat;
}) {
  const total = data.reduce((sum, p) => sum + p.count, 0);
  const max = Math.max(1, ...data.map((p) => p.count));
  const tMonths = await getTranslations({ locale, namespace: "MonthsAbbr" });

  const formatMonth = (s: string) => {
    const [y, m] = s.split("-");
    return `${m}/${y}`;
  };
  const first = data[0];
  const last = data.at(-1);
  const rangeLabel =
    first && last
      ? `${formatMonth(first.month)} – ${formatMonth(last.month)}`
      : "";

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-3 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {t("sparklineTitle")}
      </p>
      <p className="mt-1 truncate text-base font-semibold text-gray-900">
        {nf.format(total)} {t("statFinds", { count: total })}
      </p>
      <div className="mt-1.5 flex flex-1 flex-col gap-1">
        {/* min-h floors the chart: the bars are %-of-container tall, and
            on single-column (mobile) layouts no grid sibling stretches
            the card, so flex-1 would collapse to content height and every
            bar would bottom out at its 2px minHeight. On lg the stretched
            height usually exceeds the floor, so desktop is unchanged. */}
        <div
          className="grid min-h-16 flex-1 grid-cols-12 gap-px"
          role="img"
          aria-label={t("sparklineAria")}
        >
          {data.map((p) => {
            // Scale to 85% so the tallest bar leaves headroom for the
            // count label that sits just above it.
            const hPct = max > 0 ? (p.count / max) * 85 : 0;
            return (
              <div
                key={p.month}
                className="flex h-full flex-col items-center justify-end gap-0.5"
              >
                <span className="text-[9px] font-medium leading-none tabular-nums text-gray-600">
                  {p.count > 0 ? nf.format(p.count) : ""}
                </span>
                <div
                  className="w-full rounded-sm"
                  style={{
                    height: `${hPct}%`,
                    minHeight: p.count > 0 ? "2px" : "1px",
                    backgroundColor: "#4d9748",
                    opacity: p.count === 0 ? 0.2 : 0.9,
                  }}
                />
              </div>
            );
          })}
        </div>
        <ul aria-hidden className="grid grid-cols-12 gap-px text-center">
          {data.map((p) => {
            const m = Number(p.month.split("-")[1] ?? "0");
            return (
              <li
                key={p.month}
                className="text-[9px] font-medium leading-none text-gray-600"
              >
                {m >= 1 && m <= 12 ? tMonths(String(m)) : ""}
              </li>
            );
          })}
        </ul>
      </div>
      <p className="mt-2 text-center text-xs tabular-nums text-gray-500">
        {rangeLabel}
      </p>
    </div>
  );
}
