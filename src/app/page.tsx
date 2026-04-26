import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ListIcon, MapPin } from "lucide-react";
import { getHomePageData, type HomePageData } from "@/lib/queries/home";
import { getRandomFindShowcase } from "@/lib/queries/random-find";
import { getWatermarkMeta } from "@/lib/queries/watermark";
import {
  formatDateCs,
  formatDateTimeCs,
  formatLocationId,
  formatShortDateCs,
  formatTimeSinceCs,
  pluralCs,
  FINDS,
  LOCATIONS,
  YEARS,
} from "@/lib/format";
import { formatGpsApple } from "@/lib/gpsFormat";
import { FindThumbnail } from "@/components/finds/find-thumbnail";
import { RandomFindShowcaseWidget } from "@/components/finds/random-find-showcase";
import { CloverFactCard } from "@/components/home/clover-fact-card";

// Must be a literal for Next.js static analysis. Matches HOME_REVALIDATE in
// src/lib/constants.ts (1 hour).
export const revalidate = 3600;

const CITIES = ["město", "města", "měst"] as const;
const COUNTRIES = ["země", "země", "zemí"] as const;

const NF_CS = new Intl.NumberFormat("cs-CZ");

export default async function HomePage() {
  const [data, watermark, randomFind] = await Promise.all([
    getHomePageData(),
    getWatermarkMeta(),
    getRandomFindShowcase(),
  ]);
  const { totals } = data;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Hero. Up to lg the layout is the same centered stack as
          before; on lg+ the title sits in a left column with the
          pinned-paper "Drobnost o čtyřlístcích" card pushed to the
          right column. The card stacks below on smaller screens
          (handled by CloverFactCard's own justify rules) and the
          centered hero block keeps its symmetry there. */}
      <section className="lg:flex lg:items-center lg:gap-8">
        <div className="text-center lg:flex-1">
          <Image
            src="/clover.png"
            alt=""
            aria-hidden
            width={1024}
            height={1024}
            priority
            className="mx-auto h-32 w-32 sm:h-40 sm:w-40"
          />
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
            Čtyřlístkotéka
          </h1>
          {watermark && (
            // The same brand watermark that gets baked into every find
            // photo. Served via /api/watermark from DATA_DIR (the file
            // is outside public/ — see src/lib/queries/watermark.ts).
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
              className="mx-auto mt-4 h-20 w-auto opacity-70 sm:h-24"
            />
          )}
          <p className="mx-auto mt-3 max-w-2xl text-base text-gray-600 sm:text-lg">
            Veřejná prezentace soukromé sbírky čtyřlístků — tisíce nálezů,
            zaznamenaných lokalit a GPS souřadnic.
          </p>
          {totals.latestFoundAt && (
            <p className="mt-2 text-xs text-gray-400">
              Naposledy doplněno{" "}
              {formatShortDateCs(new Date(totals.latestFoundAt))}
            </p>
          )}
        </div>
        <div className="mt-8 lg:mt-0 lg:w-80 lg:shrink-0">
          <CloverFactCard />
        </div>
      </section>

      <section className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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

      <DonatedShowcase count={totals.donated} />

      <section className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <span className="relative inline-block">
          <span className="text-2xl font-bold text-brand-700 sm:text-3xl">
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
        </span>{" "}
        čtyřlístků.
      </p>

      <svg
        viewBox="0 0 600 110"
        preserveAspectRatio="xMidYMid meet"
        className="mx-auto mt-4 h-28 w-full max-w-2xl sm:h-32"
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

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Poslední nález
      </h2>
      <Link
        href={`/sbirka/${latestFind.id}`}
        className="group flex flex-col gap-4 overflow-hidden rounded-xl border border-gray-200 bg-white p-3 transition hover:border-brand-200 hover:shadow-sm sm:flex-row sm:items-center sm:p-4"
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
            <p
              className="mt-1 truncate text-sm text-gray-700"
              title={latestFind.location.code}
            >
              {latestFind.location.code}{" "}
              <span className="font-mono text-xs text-gray-500">
                {formatLocationId(latestFind.location.id)}
              </span>
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

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Zajímavosti
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <HighlightCard
          label="Sbírka začala"
          value={highlights.firstYear ? `${highlights.firstYear}` : "—"}
          hint={
            // Precise to hours so the card visibly ticks forward across
            // ISR refreshes (revalidate = 1 h). formatTimeSinceCs already
            // lowercases "před"; capitalise it so the hint reads as a
            // standalone sentence under the headline year.
            highlights.firstFoundAt
              ? capitalise(
                  formatTimeSinceCs(new Date(highlights.firstFoundAt)),
                )
              : null
          }
        />
        <HighlightCard
          label="Nejlepší den"
          value={
            peakDay
              ? `${NF_CS.format(peakDay.count)} ${pluralCs(peakDay.count, FINDS)}`
              : "—"
          }
          hint={peakDay ? formatDateCs(new Date(peakDay.startsAt)) : null}
        />
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
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Top lokalita
      </p>
      <p
        className="mt-1 truncate text-base font-semibold text-gray-900"
        title={location.code}
      >
        {location.code}
      </p>
      <p className="mt-0.5 text-xs text-gray-500">
        {NF_CS.format(location.count)} {pluralCs(location.count, FINDS)}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {/* /sbirka's `loc` filter folds parent → children automatically
            (see buildWhere in src/lib/queries/finds.ts), so a parent
            location surfaces every find across its sub-parts. */}
        <Link
          href={`/sbirka?loc=${location.id}`}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          <ListIcon className="h-3.5 w-3.5" aria-hidden />
          <span>Ukázat nálezy</span>
        </Link>
        {/* Mirrors MapLink in src/components/locations/location-list-row.tsx
            — same /mapa?focus deep-link pattern so behaviour matches the
            location list on /lokality exactly. */}
        <Link
          href={`/mapa?focus=${location.id}`}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          <span>Ukázat na mapě</span>
        </Link>
      </div>
    </div>
  );
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
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
    <div className="rounded-xl border border-gray-200 bg-white p-4">
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

/**
 * Mini bar sparkline for the last 12 months. Inline SVG keeps the bundle
 * size of the home page minimal — Recharts is overkill for a 120×40 px
 * chart with no axes or interactivity. We render bars (instead of a line)
 * so a single quiet month doesn't visually dent into the previous bar.
 */
function SparklineCard({
  data,
}: {
  data: HomePageData["recentMonthly"];
}) {
  const total = data.reduce((sum, p) => sum + p.count, 0);
  const max = Math.max(1, ...data.map((p) => p.count));
  const bars = data.length;
  const W = 120;
  const H = 40;
  const gap = 2;
  const barW = (W - gap * (bars - 1)) / bars;

  const lastLabel = (() => {
    const last = data.at(-1);
    if (!last) return "";
    const [y, m] = last.month.split("-");
    return `${m}/${y}`;
  })();

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Posledních 12 měsíců
      </p>
      <p className="mt-1 truncate text-base font-semibold text-gray-900">
        {NF_CS.format(total)} {pluralCs(total, FINDS)}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 h-10 w-full"
        role="img"
        aria-label="Měsíční aktivita posledních 12 měsíců"
      >
        {data.map((p, i) => {
          const h = p.count === 0 ? 0 : (p.count / max) * (H - 2);
          const x = i * (barW + gap);
          const y = H - h;
          return (
            <rect
              key={p.month}
              x={x}
              y={y}
              width={barW}
              height={h || 0.5}
              rx={1}
              fill="#4d9748"
              opacity={p.count === 0 ? 0.2 : 0.9}
            />
          );
        })}
      </svg>
      <p className="mt-1 text-xs text-gray-500">končí {lastLabel}</p>
    </div>
  );
}
