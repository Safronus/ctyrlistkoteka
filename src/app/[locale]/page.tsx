import Image from "next/image";
import { ArrowRight, ExternalLink, ListIcon, MapPin } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getHomePageData, type HomePageData } from "@/lib/queries/home";
import { getRandomFindShowcase } from "@/lib/queries/random-find";
import { getRetrospective } from "@/lib/queries/retrospective";
import { getWatermarkMeta } from "@/lib/queries/watermark";
import {
  formatDateCs,
  formatDateTimeCs,
  formatLocationId,
  formatShortDateTimeCs,
  locationDetailHref,
} from "@/lib/format";
import { formatGpsApple } from "@/lib/gpsFormat";
import { FindThumbnail } from "@/components/finds/find-thumbnail";
import { RandomFindShowcaseWidget } from "@/components/finds/random-find-showcase";
import { CloverFactCard } from "@/components/home/clover-fact-card";
import { CloverFactsStatCard } from "@/components/home/clover-facts-stat-card";
import { DonatedSearchCatcher } from "@/components/home/donated-search-catcher";
import { RetrospectiveGrid } from "@/components/home/retrospective-grid";
import {
  getCloverTexts,
  getCloverTranslations,
} from "@/lib/cloverTextsServer";
import type { CloverText } from "@/lib/cloverTexts";

type HomeT = Awaited<ReturnType<typeof getTranslations<"Home">>>;

// Must be a literal for Next.js static analysis. Matches HOME_REVALIDATE in
// src/lib/constants.ts (1 hour).
export const revalidate = 3600;

function toIntlLocale(locale: string): string {
  if (locale === "cs") return "cs-CZ";
  if (locale === "en") return "en-GB";
  return locale;
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
  ] = await Promise.all([
    getHomePageData(),
    getWatermarkMeta(),
    getRandomFindShowcase(),
    getRetrospective(),
    getCloverTexts(),
    getCloverTranslations(),
  ]);
  const { totals, highlights } = data;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Hero, three-tier composition:
          1. Title centered across the full width.
          2. Trio row — clover logo · pinned-paper fact · watermark
             smiley — flexed in a centered row on lg+, stacked on
             smaller screens (paper card sits between the two brand
             marks, balanced on each side).
          3. Intro paragraph + "naposledy doplněno" line, centered. */}
      <section>
        <h1 className="ctyr-hero-title text-center text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
          Čtyřlístkotéka
        </h1>

        <div className="mt-6 flex flex-col items-center justify-center gap-4 sm:gap-5 lg:flex-row">
          <Image
            src="/clover.png"
            alt=""
            aria-hidden
            width={1024}
            height={1024}
            priority
            className="hidden shrink-0 lg:-mr-2 lg:block lg:h-32 lg:w-32"
          />
          <div className="relative">
            <CloverFactCard
              texts={cloverTexts}
              translations={cloverTranslations}
            />
            <Image
              src="/clover.png"
              alt=""
              aria-hidden
              width={1024}
              height={1024}
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
        {(totals.latestFoundAt || highlights.firstFoundAt) && (
          <div className="mt-2 text-center text-xs text-gray-400">
            {highlights.firstFoundAt && (
              <p>
                {t("firstFound")}{" "}
                <span className="text-gray-500">
                  {formatShortDateTimeCs(
                    new Date(highlights.firstFoundAt),
                    locale,
                  )}
                </span>
              </p>
            )}
            {totals.latestFoundAt && (
              <p>
                {t("lastUpdated")}{" "}
                <span className="text-gray-500">
                  {formatShortDateTimeCs(
                    new Date(totals.latestFoundAt),
                    locale,
                  )}
                </span>
              </p>
            )}
          </div>
        )}
      </section>

      <DonatedShowcase count={totals.donated} t={t} nf={NF} />

      <section className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <NavCard
          href="/sbirka"
          title={t("navSbirkaTitle")}
          description={t("navSbirkaDesc")}
        />
        <NavCard
          href="/lokality"
          title={t("navLokalityTitle")}
          description={t("navLokalityDesc")}
        />
        <NavCard
          href="/mapa"
          title={t("navMapaTitle")}
          description={t("navMapaDesc")}
        />
        <NavCard
          href="/statistiky"
          title={t("navStatistikyTitle")}
          description={t("navStatistikyDesc")}
        />
      </section>

      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          value={NF.format(totals.finds)}
          label={t("statFinds", { count: totals.finds })}
        />
        <StatCard
          value={NF.format(totals.locations)}
          label={t("statLocations", { count: totals.locations })}
        />
        <StatCard
          value={NF.format(totals.cities)}
          label={t("statCities", { count: totals.cities })}
        />
        <StatCard
          value={NF.format(totals.countries)}
          label={t("statCountries", { count: totals.countries })}
        />
        <StatCard
          value={totals.yearsSpan ? String(totals.yearsSpan) : "—"}
          label={t("statYears", { count: totals.yearsSpan ?? 0 })}
        />
      </section>

      {retrospective && <RetrospectiveGrid data={retrospective} />}

      <HighlightsSection
        highlights={data.highlights}
        recentMonthly={data.recentMonthly}
        t={t}
        locale={locale}
        nf={NF}
        cloverTexts={cloverTexts}
      />

      {data.latestFind && (
        <LatestFindSection
          latestFind={data.latestFind}
          t={t}
          locale={locale}
        />
      )}

      <RandomFindShowcaseWidget initial={randomFind} />
    </div>
  );
}

function DonatedShowcase({
  count,
  t,
  nf,
}: {
  count: number;
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

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-brand-50 p-4 text-center">
      <p className="text-2xl font-bold text-brand-700 sm:text-3xl">{value}</p>
      <p className="mt-1 text-xs text-gray-600 sm:text-sm">{label}</p>
    </div>
  );
}

function NavCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-gray-200 bg-white p-5 transition hover:border-brand-200 hover:shadow-sm"
    >
      <h2 className="text-lg font-semibold text-gray-900 group-hover:text-brand-700">
        {title}
      </h2>
      <p className="mt-1 text-sm text-gray-600">{description}</p>
    </Link>
  );
}

async function LatestFindSection({
  latestFind,
  t,
  locale,
}: {
  latestFind: NonNullable<HomePageData["latestFind"]>;
  t: HomeT;
  locale: string;
}) {
  const tRow = await getTranslations("FindRow");
  const altText = latestFind.isAnonymized
    ? tRow("anonymizedAlt", { id: latestFind.id })
    : tRow("findAlt", { id: latestFind.id });
  const foundAtDate = latestFind.foundAt ? new Date(latestFind.foundAt) : null;
  const showMapLink =
    !latestFind.isAnonymized && latestFind.coordinates !== null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {t("latestFindHeading")}
      </h2>
      <div className="group flex items-stretch overflow-hidden rounded-xl border border-gray-200 bg-white transition hover:border-brand-200 hover:shadow-sm">
        <Link
          href={`/sbirka/${latestFind.id}`}
          className="flex min-w-0 flex-1 flex-col gap-4 p-3 sm:flex-row sm:items-center sm:p-4"
        >
        <FindThumbnail
          image={latestFind.primaryImage}
          alt={altText}
          className="aspect-square w-full shrink-0 rounded-lg sm:w-32"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-2xl font-bold text-gray-900 group-hover:text-brand-700">
              #{latestFind.id}
            </span>
            {foundAtDate && (
              <span className="text-sm text-gray-500">
                {formatDateTimeCs(foundAtDate, locale)}
              </span>
            )}
          </div>
          {latestFind.isAnonymized ? (
            <p className="mt-1 text-sm text-gray-500">
              {t("latestFindAnonymizedLocation")}
            </p>
          ) : latestFind.location ? (
            <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm">
              <span className="font-mono text-xs text-gray-500">
                {formatLocationId(latestFind.location.id)}
              </span>
              <span className="text-gray-400">–</span>
              <span
                className="truncate text-gray-800"
                title={latestFind.location.code}
              >
                {latestFind.location.code}
              </span>
              {latestFind.location.displayName &&
                latestFind.location.displayName !==
                  latestFind.location.code && (
                  <span
                    className="truncate text-gray-500"
                    title={latestFind.location.displayName}
                  >
                    ({latestFind.location.displayName})
                  </span>
                )}
            </p>
          ) : (
            <p className="mt-1 text-sm text-gray-500">
              {t("latestFindNoLocation")}
            </p>
          )}
          {latestFind.coordinates && (
            <p className="mt-1 truncate font-mono text-xs text-gray-500">
              {formatGpsApple(
                latestFind.coordinates.lat,
                latestFind.coordinates.lng,
              )}
            </p>
          )}
          <p className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700">
            {t("latestFindDetail")}
            <ArrowRight
              className="h-4 w-4 transition group-hover:translate-x-0.5"
              aria-hidden
            />
          </p>
        </div>
      </Link>
      {showMapLink && (
        <Link
          href={`/mapa?find=${latestFind.id}`}
          aria-label={t("latestFindShowOnMap")}
          title={t("latestFindShowOnMap")}
          className="flex shrink-0 items-center justify-center border-l border-gray-100 px-3 text-gray-400 transition hover:bg-brand-100 hover:text-brand-700 focus:bg-brand-100 focus:text-brand-700 focus:outline-none"
        >
          <MapPin className="h-5 w-5" aria-hidden />
        </Link>
      )}
      </div>
    </section>
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
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {t("highlightsHeading")}
      </h2>
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
    <div className="relative flex flex-col rounded-xl border border-gray-200 bg-white p-3">
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
  const timeFmt = new Intl.DateTimeFormat(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Prague",
  });
  const fromTo = `${timeFmt.format(firstAt)}–${timeFmt.format(lastAt)}`;
  const durationMin = Math.max(
    0,
    Math.round((lastAt.getTime() - firstAt.getTime()) / 60_000),
  );
  const durationLabel = formatDurationMinutes(durationMin);
  const netLabel = formatDurationMinutes(peakDay.netMinutes);
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-3">
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
    <div className="rounded-xl border border-gray-200 bg-white p-3">
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
  const bars = data.length;
  const BAR_VB_W = 120;
  const BAR_VB_H = 40;
  const gap = 2;
  const barW = (BAR_VB_W - gap * (bars - 1)) / bars;
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
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {t("sparklineTitle")}
      </p>
      <p className="mt-1 truncate text-base font-semibold text-gray-900">
        {nf.format(total)} {t("statFinds", { count: total })}
      </p>
      <div className="mt-1.5 flex flex-1 flex-col gap-1">
        <svg
          viewBox={`0 0 ${BAR_VB_W} ${BAR_VB_H}`}
          preserveAspectRatio="none"
          className="w-full flex-1"
          role="img"
          aria-label={t("sparklineAria")}
        >
          {data.map((p, i) => {
            const h = p.count === 0 ? 0 : (p.count / max) * (BAR_VB_H - 1);
            const x = i * (barW + gap);
            const y = BAR_VB_H - h;
            return (
              <rect
                key={p.month}
                x={x}
                y={y}
                width={barW}
                height={h || 0.5}
                fill="#4d9748"
                opacity={p.count === 0 ? 0.2 : 0.9}
              />
            );
          })}
        </svg>
        <ul aria-hidden className="grid grid-cols-12 gap-px text-center">
          {data.map((p) => {
            const m = Number(p.month.split("-")[1] ?? "0");
            return (
              <li
                key={p.month}
                className="text-[9px] font-medium leading-none text-gray-400"
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
