import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ExternalLink, ListIcon, MapPin } from "lucide-react";
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
  pluralCs,
  FINDS,
  LOCATIONS,
  YEARS,
} from "@/lib/format";
import { formatGpsApple } from "@/lib/gpsFormat";
import { FindThumbnail } from "@/components/finds/find-thumbnail";
import { RandomFindShowcaseWidget } from "@/components/finds/random-find-showcase";
import { CloverFactCard } from "@/components/home/clover-fact-card";
import { CloverFactsStatCard } from "@/components/home/clover-facts-stat-card";
import { DonatedSearchCatcher } from "@/components/home/donated-search-catcher";
import { RetrospectiveGrid } from "@/components/home/retrospective-grid";
import { CLOVER_CATEGORY_LABELS, CLOVER_TEXTS } from "@/lib/cloverTexts";

// Must be a literal for Next.js static analysis. Matches HOME_REVALIDATE in
// src/lib/constants.ts (1 hour).
export const revalidate = 3600;

const CITIES = ["město", "města", "měst"] as const;
const COUNTRIES = ["země", "země", "zemí"] as const;

const NF_CS = new Intl.NumberFormat("cs-CZ");

export default async function HomePage() {
  const [data, watermark, randomFind, retrospective] = await Promise.all([
    getHomePageData(),
    getWatermarkMeta(),
    getRandomFindShowcase(),
    getRetrospective(),
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
          {/* Standalone clover — lg+ only (full horizontal trio). Below
              lg we switch to compact decorative overlays directly on
              the card so the page doesn't pad out vertically with two
              extra full-size icons. */}
          <Image
            src="/clover.png"
            alt=""
            aria-hidden
            width={1024}
            height={1024}
            priority
            className="hidden shrink-0 lg:-mr-2 lg:block lg:h-32 lg:w-32"
          />
          {/* Card + below-lg decorative overlays. The wrapper is
              `relative` so the overlays anchor to the card; on lg+
              `lg:hidden` removes them and the standalone icons take
              over. Both overlays use the same h-14 square so they
              read as a balanced pair on the card. */}
          <div className="relative">
            <CloverFactCard />
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
              // Anchor the watermark at the bottom-left corner peeking
              // outside the card, mirroring the clover overlay at
              // top-left. Both decorations now sit as a vertical pair
              // on the left while the right side stays free for the
              // structured corner items (pin, badge, #ID, countdown).
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
            // Plain <img> mirrors FindThumbnail's pattern; we skip
            // Next/Image because Nginx serves the bytes directly in
            // production and the optimizer would just add latency.
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
            // Reserve symmetry on lg even when the watermark file isn't
            // available locally so the trio doesn't visually shift.
            <div className="hidden lg:block lg:h-32 lg:w-32 lg:shrink-0" />
          )}
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-base text-gray-600 sm:text-lg">
          Veřejná prezentace soukromé sbírky čtyřlístků — tisíce nálezů,
          zaznamenaných lokalit a GPS souřadnic.
        </p>
        {(totals.latestFoundAt || highlights.firstFoundAt) && (
          <div className="mt-2 text-center text-xs text-gray-400">
            {/* Two distinct lines on mobile, single line with a dot
             *  separator from sm up. Order: start of the collection
             *  first, latest update second — chronological reading. */}
            {highlights.firstFoundAt && (
              <p>
                První čtyřlístek zaevidován:{" "}
                <span className="text-gray-500">
                  {formatShortDateTimeCs(new Date(highlights.firstFoundAt))}
                </span>
              </p>
            )}
            {totals.latestFoundAt && (
              <p>
                Poslední aktualizace sbírky:{" "}
                <span className="text-gray-500">
                  {formatShortDateTimeCs(new Date(totals.latestFoundAt))}
                </span>
              </p>
            )}
          </div>
        )}
      </section>

      <DonatedShowcase count={totals.donated} />

      <section className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <NavCard
          href="/sbirka"
          title="Sbírka"
          description="Galerie všech nálezů s filtry, hledáním a detailem."
        />
        <NavCard
          href="/lokality"
          title="Lokality"
          description="Přehled všech lokalit, polygonů a počtů nálezů."
        />
        <NavCard
          href="/mapa"
          title="Mapa"
          description="Interaktivní mapa lokalit a všech nálezů."
        />
        <NavCard
          href="/statistiky"
          title="Statistiky"
          description="Přehled sbírky v grafech, číslech a milnících."
        />
      </section>

      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          value={NF_CS.format(totals.finds)}
          label={pluralCs(totals.finds, FINDS)}
        />
        <StatCard
          value={NF_CS.format(totals.locations)}
          label={pluralCs(totals.locations, LOCATIONS)}
        />
        <StatCard
          value={NF_CS.format(totals.cities)}
          label={pluralCs(totals.cities, CITIES)}
        />
        <StatCard
          value={NF_CS.format(totals.countries)}
          label={pluralCs(totals.countries, COUNTRIES)}
        />
        <StatCard
          value={totals.yearsSpan ? String(totals.yearsSpan) : "—"}
          label={
            totals.yearsSpan ? pluralCs(totals.yearsSpan, YEARS) : YEARS[2]
          }
        />
      </section>

      {retrospective && <RetrospectiveGrid data={retrospective} />}

      <HighlightsSection
        highlights={data.highlights}
        recentMonthly={data.recentMonthly}
      />

      {data.latestFind && <LatestFindSection latestFind={data.latestFind} />}

      <RandomFindShowcaseWidget initial={randomFind} />
    </div>
  );
}

/**
 * "Field of dispersing clovers". A static cluster on the left (the
 * collection) feeds a continuous stream of leaves drifting rightward
 * with rotation, fade, and shrink — implying clovers being given away.
 * The animation is an 8-second CSS keyframe loop; each leaf is offset
 * along the timeline by a negative `animation-delay`, so at any instant
 * the viewer sees leaves at every stage of the journey.
 *
 * Layered with the hand-underlined count above; together they read as
 * a single "X clovers left the archive" statement.
 */
function DonatedShowcase({ count }: { count: number }) {
  const DRIFTERS = 16;
  const LOOP_S = 8;

  return (
    <section className="mt-12 text-center">
      {/* The keyframe + cluster offsets are co-located here because
          this is the only consumer. React 19 hoists/deduplicates style
          tags so re-renders don't bloat the head. */}
      <style>{`
        @keyframes ctyr-drift {
          0%   { transform: translate(82px, var(--y0)) rotate(0deg)  scale(0.7);  opacity: 0; }
          12%  { opacity: 0.95; }
          70%  { opacity: 0.55; }
          100% { transform: translate(540px, calc(var(--y0) - 10px)) rotate(45deg) scale(0.5); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          /* Freeze the field — leaves stay where they would have been
             at one third of the loop, which gives a visually coherent
             still image instead of all leaves bunched at the start. */
          .ctyr-drifter {
            animation-play-state: paused !important;
          }
        }
      `}</style>

      <p className="text-base text-gray-700 sm:text-lg">
        Komu už putovalo štěstí:{" "}
        {/* The count itself doubles as a link to the donated-filter
            view of /sbirka. Aria-label spells the destination out so
            screen readers don't just hear a bare number. */}
        <Link
          href="/sbirka?state=DONATED"
          className="relative inline-block transition-transform hover:scale-[1.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 rounded-sm"
          aria-label={`${NF_CS.format(count)} darovaných čtyřlístků — zobrazit ve sbírce`}
        >
          <span className="text-2xl font-bold text-brand-700 hover:text-brand-800 sm:text-3xl">
            {NF_CS.format(count)}
          </span>
          {/* Hand-drawn squiggle under the number — bezier waves vary so
              it doesn't look machine-perfect. Width spans the parent. */}
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
        čtyřlístků.
      </p>

      <svg
        viewBox="0 0 600 110"
        preserveAspectRatio="xMidYMid meet"
        className="mx-auto mt-1.5 h-28 w-full max-w-2xl sm:h-32"
        aria-hidden
      >
        {/* Static cluster — the "collection" anchor. Six overlapping
            clovers at slightly varied positions/sizes for depth. */}
        {STATIC_CLUSTER.map((c, i) => (
          <g
            key={`s${i}`}
            transform={`translate(${c.x} ${c.y}) scale(${c.s})`}
            opacity={c.o}
          >
            <CloverShape />
          </g>
        ))}

        {/* Animated drifters. Each starts at the cluster (CSS keyframe
            origin) and ends ~450 px to the right with rotation. */}
        {Array.from({ length: DRIFTERS }, (_, i) => {
          // Vary start Y within the cluster so leaves don't track the
          // exact same path. Modular arithmetic keeps the result
          // deterministic so SSR markup is stable.
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

      {/* Recipient lookup — the catcher glow above is the visual hook,
          this form is where it all lands. Submit goes through a server
          action that validates format → existence → DONATED state and
          redirects to /sbirka/<id> on success. */}
      <DonatedSearchCatcher />
    </section>
  );
}

/** Clover drawn at origin (0, 0) so callers can position it via a
 *  parent `<g transform>` or CSS transform without offset gymnastics. */
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

function LatestFindSection({
  latestFind,
}: {
  latestFind: NonNullable<HomePageData["latestFind"]>;
}) {
  const altText = latestFind.isAnonymized
    ? `Anonymizovaný nález #${latestFind.id}`
    : `Nález #${latestFind.id}`;
  const foundAtDate = latestFind.foundAt ? new Date(latestFind.foundAt) : null;
  // Same gating as FindListRow on /sbirka — the map deep-link only
  // makes sense when the find has a public GPS point. Anonymized
  // finds expose at most coarsened coords, so pinning them precisely
  // would defeat anonymization.
  const showMapLink =
    !latestFind.isAnonymized && latestFind.coordinates !== null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Poslední nález
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
                {formatDateTimeCs(foundAtDate)}
              </span>
            )}
          </div>
          {latestFind.isAnonymized ? (
            <p className="mt-1 text-sm text-gray-500">Anonymizovaná lokalita</p>
          ) : latestFind.location ? (
            // Mirrors FindTitle in src/components/finds/find-list.tsx
            // — same shape (#0042 – CODE (popis)) so the home card and
            // the /sbirka list speak the same language.
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
            <p className="mt-1 text-sm text-gray-500">Bez lokality</p>
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
            Detail nálezu
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
          aria-label="Zobrazit nález na mapě"
          title="Zobrazit nález na mapě"
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
}: {
  highlights: HomePageData["highlights"];
  recentMonthly: HomePageData["recentMonthly"];
}) {
  const peakDay = highlights.peakDay;
  const top = highlights.topLocation;
  // Bundled JSON, evaluated once per render — cheap enough to inline.
  // Surfacing the breadth of the rotator (count, author bonuses, distinct
  // categories incl. the actual category list) was the point of
  // replacing "Sbírka začala" here.
  const distinctCategoryKeys = Array.from(
    new Set(CLOVER_TEXTS.map((t) => t.category)),
  );
  const categoryLabels = distinctCategoryKeys
    .map((key) => CLOVER_CATEGORY_LABELS[key] ?? key)
    .sort((a, b) => a.localeCompare(b, "cs-CZ"));
  const cloverFactsStats = {
    total: CLOVER_TEXTS.length,
    bonus: CLOVER_TEXTS.filter((t) => t.author === true).length,
    categories: distinctCategoryKeys.length,
    categoryLabels,
  };

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Zajímavosti
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CloverFactsStatCard
          total={cloverFactsStats.total}
          bonus={cloverFactsStats.bonus}
          categories={cloverFactsStats.categories}
          categoryLabels={cloverFactsStats.categoryLabels}
        />
        {peakDay ? (
          <PeakDayCard peakDay={peakDay} />
        ) : (
          <HighlightCard label="Nejlepší den" value="—" hint={null} />
        )}
        {top ? (
          <TopLocationCard location={top} />
        ) : (
          <HighlightCard label="Top lokalita" value="—" hint={null} />
        )}
        <SparklineCard data={recentMonthly} />
      </div>
    </section>
  );
}

function TopLocationCard({
  location,
}: {
  location: NonNullable<HomePageData["highlights"]["topLocation"]>;
}) {
  const netLabel = formatDurationMinutes(location.netMinutes);
  return (
    <div className="relative flex flex-col rounded-xl border border-gray-200 bg-white p-3">
      {/* Discreet shortcut to /lokality/<id> in the corner — same icon
          shape used on the /lokality list rows and /statistiky leaderboards
          so the meaning ("open detail") stays consistent across pages.
          Pinned absolute so the title row keeps its baseline alignment
          regardless of card height. */}
      <Link
        href={locationDetailHref(location.id)}
        aria-label="Detail lokality"
        title="Detail lokality"
        className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition hover:bg-brand-50 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500"
      >
        <ExternalLink className="h-4 w-4" aria-hidden />
      </Link>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Top lokalita
      </p>
      <p
        className="mt-1 truncate pr-8 text-base font-semibold text-gray-900"
        title={location.code}
      >
        {location.code}
      </p>
      <p className="mt-0.5 text-xs text-gray-500">
        {NF_CS.format(location.count)} {pluralCs(location.count, FINDS)}
      </p>
      {/* Net picking time across this location's full history (folds
          parent → children). Same session math + baseline as the
          PeakDayCard, just bucketed per (location, day) instead of
          one fixed day. flex-1 absorbs the slack above the action
          buttons so the rate line lands centred regardless of how
          tall the neighbouring cards grow. */}
      {netLabel && (
        <div className="flex flex-1 flex-col items-center justify-center py-1.5 text-center">
          <p
            className="font-mono text-base font-semibold tabular-nums text-gray-900"
            title="Součet trvání jednotlivých 'sezení' v této lokalitě (pauzy delší než 15 min se nezapočítávají)"
          >
            {netLabel}
          </p>
          <p className="text-[11px] leading-tight text-gray-500">
            čistý čas sbírání
          </p>
          {location.netMinutes > 0 && (
            <p
              className="mt-0.5 font-mono text-[11px] leading-tight tabular-nums text-gray-500"
              title="Průměrný počet čtyřlístků za minutu čistého času v této lokalitě"
            >
              {new Intl.NumberFormat("cs-CZ", {
                maximumFractionDigits: 1,
              }).format(location.count / location.netMinutes)}{" "}
              čtyřlístku/min
            </p>
          )}
        </div>
      )}
      <div className="mt-auto flex flex-col gap-1.5 pt-2">
        {/* /sbirka's `loc` filter folds parent → children automatically
            (see buildWhere in src/lib/queries/finds.ts), so a parent
            location surfaces every find across its sub-parts. Buttons
            stretch full-width per the home-card design — both actions
            are equally weighted, no reason to make them auto-sized
            chips. `mt-auto` pins the action block to the card's
            bottom edge so neighbouring cards line up regardless of
            the body content height. */}
        <Link
          href={`/sbirka?loc=${location.id}`}
          className="flex w-full items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          <ListIcon className="h-3.5 w-3.5" aria-hidden />
          <span>Ukázat nálezy</span>
        </Link>
        {/* Mirrors MapLink in src/components/locations/location-list-row.tsx
            — same /mapa?focus deep-link pattern so behaviour matches the
            location list on /lokality exactly. */}
        <Link
          href={`/mapa?focus=${location.id}`}
          className="flex w-full items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          <span>Ukázat na mapě</span>
        </Link>
      </div>
    </div>
  );
}

/** "Best day" highlight with the same look as HighlightCard plus a
 *  full-width action button that deep-links into /sbirka pre-filtered
 *  to that single day via the `from`/`to` date-range params (start =
 *  end = the peak date, so the inclusive-day-range matches exactly). */
function PeakDayCard({
  peakDay,
}: {
  peakDay: NonNullable<HomePageData["highlights"]["peakDay"]>;
}) {
  const date = new Date(peakDay.startsAt);
  const firstAt = new Date(peakDay.firstAt);
  const lastAt = new Date(peakDay.lastAt);
  // Slice the ISO string so the day stays in UTC (matches how the
  // /sbirka filter parses `from`/`to` — see parseDateOnly there).
  const isoDay = date.toISOString().slice(0, 10);
  // EXIF DateTimeOriginal is wall-clock at the location (no zone) —
  // format it in `Europe/Prague` so a CZ-day's harvest doesn't render
  // as 22:00–05:30 UTC on the page.
  const timeFmt = new Intl.DateTimeFormat("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Prague",
  });
  const fromTo = `${timeFmt.format(firstAt)}–${timeFmt.format(lastAt)}`;
  // Duration in minutes — clamped at 0 in case both timestamps land on
  // the same minute (single-find day, or rapid-fire EXIF clock).
  const durationMin = Math.max(
    0,
    Math.round((lastAt.getTime() - firstAt.getTime()) / 60_000),
  );
  const durationLabel = formatDurationMinutes(durationMin);
  const netLabel = formatDurationMinutes(peakDay.netMinutes);
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Nejlepší den
      </p>
      <p className="mt-1 truncate text-base font-semibold text-gray-900">
        {NF_CS.format(peakDay.count)} {pluralCs(peakDay.count, FINDS)}
      </p>
      <p className="mt-0.5 text-xs text-gray-500">{formatDateCs(date)}</p>
      <p className="mt-0.5 text-xs text-gray-500">
        <span className="font-mono tabular-nums">{fromTo}</span>
        {durationLabel && (
          <>
            {" · "}
            <span title="Doba mezi prvním a posledním nálezem v ten den">
              {durationLabel}
            </span>
          </>
        )}
      </p>
      {/* "Net picking time" — sum of within-location session durations,
          where a session breaks on any > 15 min gap inside one
          location. flex-1 + items-center centres the block both
          axes inside the slack between metadata + button (auto-grows
          with neighbouring cards in the row). */}
      {netLabel && (
        <div className="flex flex-1 flex-col items-center justify-center py-1.5 text-center">
          <p
            className="font-mono text-base font-semibold tabular-nums text-gray-900"
            title="Součet trvání jednotlivých 'sezení' v rámci lokalit (pauzy delší než 15 min se nezapočítávají)"
          >
            {netLabel}
          </p>
          <p className="text-[11px] leading-tight text-gray-500">
            čistý čas sbírání
          </p>
          {peakDay.netMinutes > 0 && (
            <p
              className="mt-0.5 font-mono text-[11px] leading-tight tabular-nums text-gray-500"
              title="Průměrný počet čtyřlístků za minutu čistého času"
            >
              {new Intl.NumberFormat("cs-CZ", {
                maximumFractionDigits: 1,
              }).format(peakDay.count / peakDay.netMinutes)}{" "}
              čtyřlístku/min
            </p>
          )}
        </div>
      )}
      {/* Keep mt-auto as a fallback: when netLabel is null, the
          flex-1 above is gone and we still want the button pinned to
          the card's bottom edge so the row stays vertically aligned
          with sibling cards. */}
      <div className="mt-auto flex flex-col gap-1.5 pt-2">
        <Link
          href={`/sbirka?from=${isoDay}&to=${isoDay}`}
          className="flex w-full items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          <ListIcon className="h-3.5 w-3.5" aria-hidden />
          <span>Ukázat nálezy</span>
        </Link>
      </div>
    </div>
  );
}

/** Czech-formatted duration in hours+minutes from a raw minute count.
 *  - 0 min → null (caller hides the chip — would just clutter the row)
 *  - < 60 → "X min"
 *  - ≥ 60 → "Y h Z min" (skips "0 min" when whole hours) */
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

/** 3-letter Czech month abbreviations indexed 0..11 (Jan..Dec). Used for
 *  the per-bar labels under the home-page sparkline. */
const MONTH_ABBR_CS = [
  "led",
  "úno",
  "bře",
  "dub",
  "kvě",
  "čvn",
  "čvc",
  "srp",
  "zář",
  "říj",
  "lis",
  "pro",
];

/**
 * Mini bar sparkline for the last 12 months. Inline SVG keeps the bundle
 * size of the home page minimal — Recharts is overkill for a 120×62 px
 * chart with no axes or interactivity. We render bars (instead of a line)
 * so a single quiet month doesn't visually dent into the previous bar.
 * Month abbreviations sit under the bars rotated -90° so all 12 fit
 * without overlap regardless of card width; a centered "from – to"
 * range line sits flush to the card's bottom edge.
 */
function SparklineCard({
  data,
}: {
  data: HomePageData["recentMonthly"];
}) {
  const total = data.reduce((sum, p) => sum + p.count, 0);
  const max = Math.max(1, ...data.map((p) => p.count));
  const bars = data.length;
  // Bars-only viewBox — labels live below the SVG in the HTML grid so
  // they aren't subject to the SVG's non-uniform stretch and stay
  // readable at every card width.
  const BAR_VB_W = 120;
  const BAR_VB_H = 40;
  const gap = 2;
  const barW = (BAR_VB_W - gap * (bars - 1)) / bars;

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
        Posledních 12 měsíců
      </p>
      <p className="mt-1 truncate text-base font-semibold text-gray-900">
        {NF_CS.format(total)} {pluralCs(total, FINDS)}
      </p>
      {/* Chart absorbs every pixel of remaining vertical space inside
          the card (flex-1) and stretches its bars over the full width
          with preserveAspectRatio="none". Together with the HTML
          label row below, this means the chart no longer letterboxes
          inside the card the way a single uniform-meet SVG used to. */}
      <div className="mt-1.5 flex flex-1 flex-col gap-1">
        <svg
          viewBox={`0 0 ${BAR_VB_W} ${BAR_VB_H}`}
          preserveAspectRatio="none"
          className="w-full flex-1"
          role="img"
          aria-label="Měsíční aktivita posledních 12 měsíců"
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
        <ul
          aria-hidden
          className="grid grid-cols-12 gap-px text-center"
        >
          {data.map((p) => {
            const m = Number(p.month.split("-")[1] ?? "0") - 1;
            return (
              <li
                key={p.month}
                className="text-[9px] font-medium leading-none text-gray-400"
              >
                {MONTH_ABBR_CS[m] ?? ""}
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
