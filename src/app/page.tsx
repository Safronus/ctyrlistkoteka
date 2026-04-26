import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getHomePageData, type HomePageData } from "@/lib/queries/home";
import {
  formatCount,
  formatDateCs,
  formatLocationId,
  formatShortDateCs,
  pluralCs,
  FINDS,
  LOCATIONS,
  YEARS,
} from "@/lib/format";
import { FindThumbnail } from "@/components/finds/find-thumbnail";

// Must be a literal for Next.js static analysis. Matches HOME_REVALIDATE in
// src/lib/constants.ts (1 hour).
export const revalidate = 3600;

const CITIES = ["město", "města", "měst"] as const;
const COUNTRIES = ["země", "země", "zemí"] as const;

const NF_CS = new Intl.NumberFormat("cs-CZ");

export default async function HomePage() {
  const data = await getHomePageData();
  const { totals } = data;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <section className="text-center">
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
        <p className="mx-auto mt-3 max-w-2xl text-base text-gray-600 sm:text-lg">
          Veřejná prezentace soukromé sbírky čtyřlístků — tisíce nálezů,
          zaznamenaných lokalit a GPS souřadnic.
        </p>
        {totals.latestFoundAt && (
          <p className="mt-2 text-xs text-gray-400">
            Naposledy doplněno {formatShortDateCs(new Date(totals.latestFoundAt))}
          </p>
        )}
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

      {data.latestFind && <LatestFindSection latestFind={data.latestFind} />}

      <HighlightsSection
        highlights={data.highlights}
        recentMonthly={data.recentMonthly}
      />

      <p className="mt-8 text-center text-xs text-gray-400">
        {formatCount(totals.finds, FINDS)} ·{" "}
        {formatCount(totals.locations, LOCATIONS)}
      </p>
    </div>
  );
}

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
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900 group-hover:text-brand-700">
              #{latestFind.id}
            </span>
            {foundAtDate && (
              <span className="text-sm text-gray-500">
                {formatDateCs(foundAtDate)}
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
            highlights.firstYear
              ? `Před ${pluralCs(new Date().getFullYear() - highlights.firstYear, YEARS)}`
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
          <Link
            href={`/sbirka?location=${top.id}`}
            className="group rounded-xl border border-gray-200 bg-white p-4 transition hover:border-brand-200 hover:shadow-sm"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Top lokalita
            </p>
            <p
              className="mt-1 truncate text-base font-semibold text-gray-900 group-hover:text-brand-700"
              title={top.code}
            >
              {top.code}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              {NF_CS.format(top.count)} {pluralCs(top.count, FINDS)}
            </p>
          </Link>
        ) : (
          <HighlightCard label="Top lokalita" value="—" hint={null} />
        )}
        <SparklineCard data={recentMonthly} />
      </div>
    </section>
  );
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
