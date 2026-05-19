import { Suspense } from "react";
import type { Metadata } from "next";
import {
  Building2,
  Calendar,
  CalendarDays,
  CalendarRange,
  Camera,
  Clock,
  Compass,
  EyeOff,
  Gift,
  Globe2,
  HelpCircle,
  ImageOff,
  MapPin,
  MapPinOff,
  Search,
  Sparkles,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  formatDateTimeCs,
  formatDistance,
  formatLocationId,
  formatLongDuration,
  formatTimeSinceCs,
} from "@/lib/format";
import {
  getStatsCalendar,
  getStatsDistance,
  getStatsGeo,
  getStatsHighlights,
  getStatsJubilees,
  getStatsPeaks,
  getStatsTimeAndPace,
  getStatsTopLocations,
  getStatsTotals,
  type CalendarPoint,
  type CategoryPoint,
  type CountryPoint,
  type DistanceBucket,
  type FindHighlight,
  type JubileeFind,
  type MinuteHeatmapCell,
  type MonthDayPoint,
  type PeakBucket,
  type StatsTimeAndPaceResult,
  type YearlyPoint,
} from "@/lib/queries/stats";
import { getLocationIdsWithRealPhotos } from "@/lib/queries/locations";
import { localizedCountryName } from "@/lib/world-countries";
import { getFindIdsWithRealPhotos } from "@/lib/findPhotos";
import { prisma } from "@/lib/db";
import { CalendarHeatmapTabs } from "@/components/stats/calendar-heatmap-tabs";
import { WorldChoroplethMap } from "@/components/stats/world-choropleth-map";
import { TopLocationsCard } from "@/components/stats/top-locations-card";
import { YearlyPaceBlock } from "@/components/stats/yearly-pace-block";
import {
  CalendarSkeleton,
  DistanceSkeleton,
  GeoSkeleton,
  HighlightsSkeleton,
  JubileesSkeleton,
  PeaksSkeleton,
  TopLocationsSkeleton,
  TotalsSkeleton,
} from "@/components/stats/skeletons";

type StatsT = Awaited<ReturnType<typeof getTranslations<"Statistiky">>>;

function toIntlLocale(locale: string): string {
  if (locale === "cs") return "cs-CZ";
  if (locale === "en") return "en-GB";
  return locale;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Statistiky");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

// Matches STATS_REVALIDATE in src/lib/constants.ts (6 hours).
export const revalidate = 21600;

export default async function StatistikyPage() {
  const t = await getTranslations("Statistiky");
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-3xl font-bold text-gray-900">{t("h1")}</h1>
        <p className="mt-2 text-gray-600">{t("subtitle")}</p>
      </header>

      <Suspense fallback={<TotalsSkeleton />}>
        <TotalsSection />
      </Suspense>
      <Suspense fallback={<HighlightsSkeleton />}>
        <HighlightsSection />
      </Suspense>
      <Suspense fallback={<TimeAndPaceSkeleton />}>
        <TimeAndPaceSection />
      </Suspense>
      <Suspense fallback={<PeaksSkeleton />}>
        <PeaksSection />
      </Suspense>
      <Suspense fallback={<JubileesSkeleton />}>
        <JubileesSection />
      </Suspense>
      <Suspense fallback={<TopLocationsSkeleton />}>
        <TopLocationsSection />
      </Suspense>
      <Suspense fallback={<GeoSkeleton />}>
        <GeoSection />
      </Suspense>
      <Suspense fallback={<DistanceSkeleton />}>
        <DistanceSection />
      </Suspense>
      <Suspense fallback={<CalendarSkeleton />}>
        <CalendarSection />
      </Suspense>
    </div>
  );
}

async function TotalsSection() {
  const t = await getTranslations("Statistiky");
  const locale = await getLocale();
  const fmt = new Intl.NumberFormat(toIntlLocale(locale), {
    maximumFractionDigits: 0,
  });
  const [
    { totals, countryCount, cityCount },
    realPhotoLocs,
    realPhotoFindIds,
    donatedFindIds,
  ] = await Promise.all([
    getStatsTotals(),
    getLocationIdsWithRealPhotos(),
    getFindIdsWithRealPhotos(),
    prisma.findStateAssignment
      .findMany({
        where: {
          state: "DONATED",
          find: { isAnonymized: false },
        },
        select: { findId: true },
        distinct: ["findId"],
      })
      .then((rows) => new Set(rows.map((r) => r.findId))),
  ]);
  let donatedWithPhoto = 0;
  for (const id of realPhotoFindIds)
    if (donatedFindIds.has(id)) donatedWithPhoto += 1;
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <TotalCard
        tone="brand"
        label={t("labelTotalFinds")}
        value={fmt.format(totals.finds)}
        cornerLeft={{
          icon: Gift,
          label: t("labelDonated"),
          value: fmt.format(totals.donatedFinds),
          href: "/sbirka?state=DONATED",
        }}
        subStats={[
          {
            icon: Camera,
            label: t("labelDonatedWithPhoto"),
            value: fmt.format(donatedWithPhoto),
            href: "/sbirka?state=DONATED&hasPhoto=1",
          },
          {
            icon: Search,
            label: t("labelLost"),
            value: fmt.format(totals.lostFinds),
          },
          {
            icon: ImageOff,
            label: t("labelNoPhoto"),
            value: fmt.format(totals.noPhotoFinds),
          },
          {
            icon: EyeOff,
            label: t("labelAnonymized"),
            value: fmt.format(totals.anonymized),
          },
        ]}
      />
      <TotalCard
        tone="brand"
        label={t("labelTotalLocations")}
        value={fmt.format(totals.locations)}
        cornerLeft={{
          icon: Globe2,
          label: t("labelCountries", { count: countryCount }),
          value: fmt.format(countryCount),
        }}
        cornerRight={{
          icon: Building2,
          label: t("labelCities", { count: cityCount }),
          value: fmt.format(cityCount),
        }}
        subStats={[
          {
            icon: EyeOff,
            label: t("labelAnonymized"),
            value: fmt.format(totals.anonymizedLocations),
          },
          {
            icon: MapPinOff,
            label: t("labelGoneLocations"),
            value: fmt.format(totals.goneLocations),
            href: "/lokality?onlyGone=1",
          },
          {
            icon: Camera,
            label: t("labelLocationsWithPhoto"),
            value: fmt.format(realPhotoLocs.size),
            href: "/lokality?hasPhoto=1",
          },
        ]}
      />
    </section>
  );
}

async function HighlightsSection() {
  const t = await getTranslations("Statistiky");
  const tTimeSince = await getTranslations("TimeSince");
  const locale = await getLocale();
  const { firstFind, lastFind, farthestFind } = await getStatsHighlights();
  if (!firstFind && !lastFind && !farthestFind) return null;
  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {firstFind && (
        <FindHighlightCard
          label={t("highlightFirstFind")}
          find={firstFind}
          t={t}
          tTimeSince={tTimeSince}
          locale={locale}
        />
      )}
      {lastFind && lastFind.id !== firstFind?.id && (
        <FindHighlightCard
          label={t("highlightLastFind")}
          find={lastFind}
          t={t}
          tTimeSince={tTimeSince}
          locale={locale}
        />
      )}
      {farthestFind && (
        <FindHighlightCard
          label={t("highlightFarthestFind")}
          find={farthestFind}
          distanceMeters={farthestFind.distanceMeters}
          t={t}
          tTimeSince={tTimeSince}
          locale={locale}
        />
      )}
    </section>
  );
}

async function TimeAndPaceSection() {
  const data = await getStatsTimeAndPace();
  if (data.totalFindsWithDate === 0) return null;
  const t = await getTranslations("Statistiky");
  const locale = await getLocale();
  return <TimeAndPaceCard data={data} t={t} locale={locale} />;
}

async function PeaksSection() {
  const t = await getTranslations("Statistiky");
  const locale = await getLocale();
  const peaks = await getStatsPeaks();
  return <PeakBucketsSection peaks={peaks} t={t} locale={locale} />;
}

async function JubileesSection() {
  const t = await getTranslations("Statistiky");
  const locale = await getLocale();
  const { jubilees } = await getStatsJubilees();
  return <JubileeFindsSection jubilees={jubilees} t={t} locale={locale} />;
}

async function TopLocationsSection() {
  const { topLocations, topLocationsByDensity } = await getStatsTopLocations();
  if (topLocations.length === 0) return null;
  return (
    <TopLocationsCard
      byCount={topLocations}
      byDensity={topLocationsByDensity}
    />
  );
}

async function GeoSection() {
  const t = await getTranslations("Statistiky");
  const locale = await getLocale();
  const { byCountry, byCity } = await getStatsGeo();
  return (
    <GeoStatsSection
      byCountry={byCountry}
      byCity={byCity}
      t={t}
      locale={locale}
    />
  );
}

async function CalendarSection() {
  const t = await getTranslations("Statistiky");
  const data = await getStatsCalendar();
  return (
    <CalendarStatsSection
      byHour={data.byHour}
      byDayOfWeek={data.byDayOfWeek}
      byMonthOfYear={data.byMonthOfYear}
      yearly={data.yearly}
      firstYear={data.firstYear}
      byMonthDay={data.byMonthDay}
      byMinute={data.byMinute}
      t={t}
    />
  );
}

async function DistanceSection() {
  const t = await getTranslations("Statistiky");
  const { byDistance } = await getStatsDistance();
  if (byDistance.length === 0) return null;
  return <DistanceStatsSection byDistance={byDistance} t={t} />;
}

interface SubStat {
  icon: LucideIcon;
  label: string;
  value: string;
  href?: string;
}

function TotalCard({
  label,
  value,
  cornerLeft,
  cornerRight,
  subStats = [],
  tone = "default",
}: {
  label: string;
  value: string;
  cornerLeft?: SubStat;
  cornerRight?: SubStat;
  subStats?: readonly SubStat[];
  tone?: "default" | "brand";
}) {
  const hasCorners = !!(cornerLeft || cornerRight);
  const bg = tone === "brand" ? "bg-brand-50" : "bg-white";
  const subStatsBorder =
    tone === "brand" ? "border-brand-200" : "border-gray-100";
  return (
    <div
      className={`rounded-xl border border-gray-200 ${bg} p-6 text-center`}
    >
      {hasCorners ? (
        <div className="grid grid-cols-3 items-start gap-2">
          {cornerLeft ? (
            <CornerStat stat={cornerLeft} align="left" />
          ) : (
            <div />
          )}
          <MainNumber value={value} label={label} />
          {cornerRight ? (
            <CornerStat stat={cornerRight} align="right" />
          ) : (
            <div />
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <MainNumber value={value} label={label} />
        </div>
      )}
      {subStats.length > 0 && (
        <ul
          className={`mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t ${subStatsBorder} pt-3 text-xs text-gray-600`}
        >
          {subStats.map((s) => {
            const Icon = s.icon;
            const inner = (
              <>
                <Icon className="h-3.5 w-3.5 text-brand-700" aria-hidden />
                <span className="font-mono font-semibold tabular-nums text-gray-900">
                  {s.value}
                </span>
                <span className="text-gray-500">{s.label}</span>
              </>
            );
            return (
              <li
                key={s.label}
                title={`${s.label}: ${s.value}`}
                className="inline-flex"
              >
                {s.href ? (
                  <Link
                    href={s.href}
                    className="inline-flex items-center gap-1.5 rounded transition hover:text-brand-700 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                  >
                    {inner}
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    {inner}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TimeAndPaceCard({
  data,
  t,
  locale,
}: {
  data: StatsTimeAndPaceResult;
  t: StatsT;
  locale: string;
}) {
  const intlLocale = toIntlLocale(locale);
  const fmtPace = new Intl.NumberFormat(intlLocale, {
    maximumFractionDigits: 1,
  });
  const dateFmt = new Intl.DateTimeFormat(intlLocale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const totalLabel = formatLongDuration(data.estimatedMinutes, locale);
  const firstAtLabel = data.firstFoundAt
    ? dateFmt.format(new Date(data.firstFoundAt))
    : null;

  return (
    <section
      aria-labelledby="time-and-pace-section"
      className="space-y-6 rounded-xl border border-gray-200 bg-white p-6"
    >
      <h2 id="time-and-pace-section" className="sr-only">
        {t("timePaceHeading")}
      </h2>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col items-center justify-center text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {t("timePaceEstimate")}
          </p>
          <p className="mt-1 text-3xl font-bold text-brand-700">
            {totalLabel}
          </p>
          <p
            className="mt-1 max-w-xs text-xs text-gray-500"
            title={t("timePaceTitle")}
          >
            {t("timePaceSummary", { sessions: data.sessions })}
            {data.locationCount > 0 && (
              <> {t("timePaceSummaryAt", { count: data.locationCount })}</>
            )}
            {data.findsPerSession > 0 && (
              <>
                {" "}
                {t("timePaceAvgPerSession", {
                  avg: fmtPace.format(data.findsPerSession),
                })}
              </>
            )}{" "}
            {t("timePaceBaseline")}
          </p>
        </div>

        <div className="flex flex-col">
          <p className="text-center text-xs font-medium uppercase tracking-wide text-gray-500">
            {t("paceAllTime")}
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <PaceCell label={t("perHour")} value={fmtPace.format(data.perHour)} />
            <PaceCell label={t("perDay")} value={fmtPace.format(data.perDay)} />
            <PaceCell label={t("perWeek")} value={fmtPace.format(data.perWeek)} />
            <PaceCell
              label={t("perMonth")}
              value={fmtPace.format(data.perMonth)}
            />
            <PaceCell
              label={t("perYearLabel")}
              value={fmtPace.format(data.perYear)}
            />
          </ul>
          {firstAtLabel && (
            <p className="mt-3 text-center text-xs text-gray-500">
              {t("sinceFirstFind", { date: firstAtLabel })}
            </p>
          )}
        </div>
      </div>

      {data.perYearStats.length > 0 && (
        <div className="border-t border-gray-100 pt-5">
          <YearlyPaceBlock entries={data.perYearStats} />
        </div>
      )}
    </section>
  );
}

function PaceCell({ label, value }: { label: string; value: string }) {
  return (
    <li className="rounded-md border border-gray-200 bg-gray-50 p-2 text-center">
      <p className="font-mono text-sm font-semibold tabular-nums text-gray-900">
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-gray-500">{label}</p>
    </li>
  );
}

function TimeAndPaceSkeleton() {
  return (
    <section
      className="h-44 animate-pulse rounded-xl border border-gray-200 bg-white p-6"
      aria-hidden
    />
  );
}

function MainNumber({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <p className="text-4xl font-bold text-brand-700">{value}</p>
      <p className="mt-1 text-sm text-gray-500">{label}</p>
    </div>
  );
}

function CornerStat({
  stat,
  align,
}: {
  stat: SubStat;
  align: "left" | "right";
}) {
  const Icon = stat.icon;
  const positionCls =
    align === "left" ? "items-start text-left" : "items-end text-right";
  const inner = (
    <>
      <p className="text-2xl font-bold tabular-nums text-brand-700">
        {stat.value}
      </p>
      <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-gray-500">
        <Icon className="h-3.5 w-3.5 text-brand-700" aria-hidden />
        {stat.label}
      </p>
    </>
  );
  if (stat.href) {
    return (
      <Link
        href={stat.href}
        className={`flex flex-col rounded transition ${positionCls} hover:[&_p:last-child]:text-brand-700 hover:[&_p:last-child]:underline focus:outline-none focus:ring-2 focus:ring-brand-500/40`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={`flex flex-col ${positionCls}`}>{inner}</div>;
}

function FindHighlightCard({
  label,
  find,
  distanceMeters,
  t,
  tTimeSince,
  locale,
}: {
  label: string;
  find: FindHighlight;
  distanceMeters?: number;
  t: StatsT;
  tTimeSince: Awaited<ReturnType<typeof getTranslations<"TimeSince">>>;
  locale: string;
}) {
  const date = find.foundAt ? new Date(find.foundAt) : null;
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          {label}
        </h2>
        <span className="font-mono text-xs text-gray-500">
          {formatLocationId(find.id)}
        </span>
      </div>

      <p className="mt-2 text-base font-semibold text-gray-900">
        {date ? formatDateTimeCs(date, locale) : t("missingDate")}
      </p>
      {date && (
        <p className="text-xs text-gray-500">
          {formatTimeSinceCs(date, tTimeSince)}
        </p>
      )}

      <div className="mt-3">
        {find.location ? (
          <div>
            <p className="font-mono text-sm text-gray-900">
              {find.location.code}
            </p>
            {find.location.displayName &&
              find.location.displayName !== find.location.code && (
                <p className="text-xs text-gray-500">
                  {find.location.displayName}
                </p>
              )}
          </div>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-sm text-purple-700">
            <HelpCircle className="h-4 w-4" aria-hidden />
            {t("anonymizedLocation")}
          </p>
        )}
      </div>

      {distanceMeters !== undefined && (
        <p
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-gray-500"
          title={t("distanceFromDefaultTitle")}
        >
          <Compass className="h-3.5 w-3.5 text-brand-700" aria-hidden />
          <span className="font-mono tabular-nums text-gray-900">
            {formatDistance(distanceMeters, locale)}
          </span>
          <span>{t("distanceFromMapSuffix")}</span>
        </p>
      )}

      <div className="mt-auto flex flex-wrap justify-center gap-2 pt-4">
        <Link
          href={`/sbirka/${find.id}`}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          {t("openFind", { id: find.id })}
        </Link>
        {!find.isAnonymized && find.hasGps && (
          <Link
            href={`/mapa?find=${find.id}`}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:border-brand-200 hover:text-brand-700 hover:shadow-sm"
            aria-label={t("showFindOnMapAria", { id: find.id })}
            title={t("showOnMapTitle")}
          >
            <MapPin className="h-4 w-4" aria-hidden />
            {t("showOnMapLabel")}
          </Link>
        )}
      </div>
    </div>
  );
}

function GeoStatsSection({
  byCountry,
  byCity,
  t,
  locale,
}: {
  byCountry: readonly CountryPoint[];
  byCity: readonly CategoryPoint[];
  t: StatsT;
  locale: string;
}) {
  if (byCountry.length === 0 && byCity.length === 0) return null;
  // byCountry carries raw English names from Natural Earth. We localize
  // once here so both the leaderboard and the choropleth tooltips read
  // the same display string in the user's language.
  const localizedByCountry = byCountry.map((c) => ({
    ...c,
    name: localizedCountryName(c.name, locale),
  }));
  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-gray-900">
          {t("geoHeading")}
        </h2>
        <p className="text-sm text-gray-500">
          {t.rich("geoSubtitle", {
            code: (chunks) => <code>{chunks}</code>,
          })}
        </p>
      </header>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CountTable
          title={t("geoTopCountries")}
          rows={localizedByCountry.map((c) => ({
            key: c.code,
            label: c.name,
            count: c.count,
          }))}
          t={t}
        />
        <CountTable
          title={t("geoTopCities")}
          rows={byCity.map((c) => ({
            key: c.name,
            label: c.name,
            count: c.count,
          }))}
          maxRows={10}
          t={t}
        />
      </div>
      {localizedByCountry.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            {t("geoMapHeading")}
          </h3>
          <WorldChoroplethMap byCountry={localizedByCountry} />
        </div>
      )}
    </section>
  );
}

interface CountRow {
  key: string;
  label: string;
  count: number;
}

function CountTable({
  title,
  rows,
  maxRows,
  t,
}: {
  title: string;
  rows: readonly CountRow[];
  maxRows?: number;
  t: StatsT;
}) {
  const visible = maxRows ? rows.slice(0, maxRows) : rows;
  const max = visible.reduce((m, r) => Math.max(m, r.count), 0);
  const truncated = maxRows ? rows.length - visible.length : 0;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h3>
      {visible.length === 0 ? (
        <p className="text-sm text-gray-500">{t("noData")}</p>
      ) : (
        <ol className="space-y-1.5">
          {visible.map((r, i) => (
            <li key={r.key} className="flex items-center gap-3">
              <span className="w-6 shrink-0 text-right font-mono text-xs text-gray-500">
                {i + 1}.
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                {r.label}
              </span>
              <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-brand-500"
                  style={{
                    width: max > 0 ? `${(r.count / max) * 100}%` : "0%",
                  }}
                />
              </div>
              <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-gray-700">
                {r.count}
              </span>
            </li>
          ))}
        </ol>
      )}
      {truncated > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          {t("moreCount", { count: truncated })}
        </p>
      )}
    </div>
  );
}

const HOUR_KEYS = Array.from({ length: 24 }, (_, i) => i);
const DOW_KEYS = [1, 2, 3, 4, 5, 6, 7];
const MONTH_KEYS = Array.from({ length: 12 }, (_, i) => i + 1);

function fillSeries(
  data: readonly CalendarPoint[],
  keys: readonly number[],
): CalendarPoint[] {
  const map = new Map<number, number>();
  for (const d of data) map.set(d.key, d.count);
  return keys.map((k) => ({ key: k, count: map.get(k) ?? 0 }));
}

function CalendarStatsSection({
  byHour,
  byDayOfWeek,
  byMonthOfYear,
  yearly,
  firstYear,
  byMonthDay,
  byMinute,
  t,
}: {
  byHour: readonly CalendarPoint[];
  byDayOfWeek: readonly CalendarPoint[];
  byMonthOfYear: readonly CalendarPoint[];
  yearly: readonly YearlyPoint[];
  firstYear: number | null;
  byMonthDay: readonly MonthDayPoint[];
  byMinute: readonly MinuteHeatmapCell[];
  t: StatsT;
}) {
  const hourly = fillSeries(byHour, HOUR_KEYS);
  const daily = fillSeries(byDayOfWeek, DOW_KEYS);
  const monthly = fillSeries(byMonthOfYear, MONTH_KEYS);

  const currentYear = new Date().getFullYear();
  const startYear = firstYear ?? currentYear;
  const yearKeys = (() => {
    const out: number[] = [];
    for (let y = Math.min(startYear, currentYear); y <= currentYear; y++) {
      out.push(y);
    }
    return out;
  })();
  const yearlySeries = fillSeries(
    yearly.map((y) => ({ key: y.year, count: y.count })),
    yearKeys,
  );

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-gray-900">
          {t("calendarHeading")}
        </h2>
        <p className="text-sm text-gray-500">{t("calendarSubtitle")}</p>
      </header>

      <CalendarSubsection
        title={t("byHour")}
        data={hourly}
        labelLong={(k) => `${String(k).padStart(2, "0")}:00`}
        labelShort={(k) => String(k).padStart(2, "0")}
        tableColumns={2}
        t={t}
      />

      <CalendarSubsection
        title={t("byDayOfWeek")}
        data={daily}
        labelLong={(k) => t(`weekDay${k}`)}
        labelShort={(k) => t(`weekDay${k}Short`)}
        tableColumns={1}
        t={t}
      />

      <CalendarSubsection
        title={t("byMonthOfYear")}
        data={monthly}
        labelLong={(k) => t(`monthLong${k}`)}
        labelShort={(k) => monthShortKey(k, t)}
        tableColumns={1}
        t={t}
      />

      <CalendarSubsection
        title={t("byYear")}
        data={yearlySeries}
        labelLong={(k) => String(k)}
        labelShort={(k) => String(k)}
        tableColumns={1}
        t={t}
      />

      <CalendarHeatmapTabs
        daysView={<MonthDayHeatmap data={byMonthDay} t={t} />}
        minuteCells={byMinute}
      />
    </section>
  );
}

// Reuses the MonthsAbbr namespace shipped for the home-page sparkline so
// we don't duplicate the cs/en abbreviation table per consumer.
function monthShortKey(k: number, t: StatsT): string {
  // Statistiky doesn't define monthShort1..12 directly; reuse the long
  // form clipped to the first 3 chars when no shorter form is shipped.
  // The sparkline (home page) uses MonthsAbbr — but those keys live in
  // a different namespace, so we'd need a separate translator. Keep
  // this simple: trim long form's first 3 letters.
  const full = t(`monthLong${k}`);
  return full.slice(0, 3).toLowerCase();
}

const DAYS_PER_MONTH: Record<number, number> = {
  1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30,
  7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31,
};

const HEATMAP_EMPTY_BG = "oklch(0.97 0.04 145)";
const HEATMAP_TEXT_DARK = "oklch(0.18 0.03 145)";
const HEATMAP_X_TEXT = "oklch(0.7 0.02 145)";
const HEATMAP_BORDER = "oklch(1 0 0)";

function MonthDayHeatmap({
  data,
  t,
}: {
  data: readonly MonthDayPoint[];
  t: StatsT;
}) {
  const counts = new Map<string, number>();
  for (const p of data) counts.set(`${p.month}-${p.day}`, p.count);

  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const months = MONTH_KEYS;
  const max = data.reduce((m, p) => Math.max(m, p.count), 0);

  const monthTotals = new Map<number, number>();
  const dayTotals = new Map<number, number>();
  let grandTotal = 0;
  for (const m of months) {
    let mt = 0;
    for (const d of days) {
      if (d > (DAYS_PER_MONTH[m] ?? 31)) continue;
      const c = counts.get(`${m}-${d}`) ?? 0;
      mt += c;
      dayTotals.set(d, (dayTotals.get(d) ?? 0) + c);
      grandTotal += c;
    }
    monthTotals.set(m, mt);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        {t("heatmapHeading")}
      </h3>
      <p className="mb-3 text-xs text-gray-500">
        {t("heatmapSubtitle", { max })}
      </p>
      <div className="overflow-x-auto">
        <table className="mx-auto border-collapse text-[11px] tabular-nums">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white p-1 text-left text-gray-500">
                {/* corner */}
              </th>
              {days.map((d) => (
                <th
                  key={d}
                  className="w-7 p-0.5 text-center font-medium text-gray-500"
                >
                  {d}
                </th>
              ))}
              <th className="w-10 p-0.5 text-center font-semibold text-gray-700">
                Σ
              </th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const monthMax = DAYS_PER_MONTH[m] ?? 31;
              return (
                <tr key={m}>
                  <th className="sticky left-0 z-10 bg-white p-1 pr-2 text-right font-medium text-gray-700">
                    {capitalize(monthShortKey(m, t))}
                  </th>
                  {days.map((d) => {
                    if (d > monthMax) {
                      return (
                        <td
                          key={d}
                          className="w-7 border text-center"
                          style={{
                            backgroundColor: HEATMAP_EMPTY_BG,
                            color: HEATMAP_X_TEXT,
                            borderColor: HEATMAP_BORDER,
                          }}
                          aria-hidden
                        >
                          ×
                        </td>
                      );
                    }
                    const c = counts.get(`${m}-${d}`) ?? 0;
                    const intensity = max > 0 ? c / max : 0;
                    const L = 0.97 - intensity * 0.5;
                    const C = 0.04 + intensity * 0.13;
                    const fg = L < 0.6 ? "#ffffff" : HEATMAP_TEXT_DARK;
                    return (
                      <td
                        key={d}
                        className="w-7 border text-center"
                        style={{
                          backgroundColor: `oklch(${L} ${C} 145)`,
                          color: fg,
                          borderColor: HEATMAP_BORDER,
                        }}
                        title={`${d}. ${t(`monthLong${m}`)}: ${t("labelFinds", { count: c })}`}
                      >
                        {c}
                      </td>
                    );
                  })}
                  <td className="w-10 border border-gray-100 bg-gray-50 text-center font-semibold text-gray-700">
                    {monthTotals.get(m) ?? 0}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th className="sticky left-0 z-10 bg-white p-1 pr-2 text-right font-semibold text-gray-700">
                Σ
              </th>
              {days.map((d) => (
                <td
                  key={d}
                  className="w-7 border border-gray-100 bg-gray-50 text-center font-medium text-gray-700"
                >
                  {dayTotals.get(d) ?? 0}
                </td>
              ))}
              <td className="w-10 border border-gray-100 bg-brand-50 text-center font-bold text-brand-700">
                {grandTotal}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function CalendarSubsection({
  title,
  data,
  labelLong,
  labelShort,
  tableColumns,
  t,
}: {
  title: string;
  data: readonly CalendarPoint[];
  labelLong: (k: number) => string;
  labelShort: (k: number) => string;
  tableColumns: 1 | 2;
  t: StatsT;
}) {
  const max = data.reduce((m, d) => Math.max(m, d.count), 0);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h3>

      <div className="flex h-32 items-end gap-1 pt-5">
        {data.map((d) => (
          <div
            key={d.key}
            className="relative flex-1 rounded-t bg-brand-500"
            style={{
              height: max > 0 ? `${(d.count / max) * 100}%` : "0%",
              minHeight: d.count > 0 ? "2px" : "0",
            }}
            title={`${labelLong(d.key)}: ${d.count}`}
          >
            {d.count > 0 && (
              <span className="absolute -top-4 left-1/2 -translate-x-1/2 font-mono text-[10px] tabular-nums text-gray-700">
                {d.count}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {data.map((d) => (
          <span
            key={d.key}
            className="flex-1 truncate text-center font-mono text-[10px] text-gray-500"
          >
            {labelShort(d.key)}
          </span>
        ))}
      </div>

      <details className="mt-4 group">
        <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wide text-gray-500 hover:text-gray-700">
          {t("valueTable")}
        </summary>
        <dl
          className={`mt-2 grid gap-x-6 gap-y-1 text-sm ${
            tableColumns === 2 ? "grid-cols-2" : "grid-cols-1"
          }`}
        >
          {data.map((d) => (
            <div
              key={d.key}
              className="flex items-baseline justify-between border-b border-gray-100 py-1"
            >
              <dt className="text-gray-700">{labelLong(d.key)}</dt>
              <dd className="font-mono tabular-nums text-gray-900">
                {d.count}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

const DISTANCE_BUCKET_KEYS = [
  ["distLT10m", "distLT10mShort"],
  ["dist10_100m", "dist10_100m"],
  ["dist100m_1km", "dist100m_1kmShort"],
  ["dist1_10km", "dist1_10km"],
  ["dist10_100km", "dist10_100km"],
  ["dist100_1000km", "dist100_1000km"],
  ["dist1000_10000km", "dist1000_10000km"],
  ["distGT10000km", "distGT10000kmShort"],
] as const;

const DISTANCE_BUCKET_INDICES = DISTANCE_BUCKET_KEYS.map((_, i) => i);

function DistanceStatsSection({
  byDistance,
  t,
}: {
  byDistance: readonly DistanceBucket[];
  t: StatsT;
}) {
  const series = fillSeries(
    byDistance.map((b) => ({ key: b.bucket, count: b.count })),
    DISTANCE_BUCKET_INDICES,
  );
  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-gray-900">
          {t("distanceHeading")}
        </h2>
        <p className="text-sm text-gray-500">{t("distanceSubtitle")}</p>
      </header>
      <CalendarSubsection
        title={t("distanceTitle")}
        data={series}
        labelLong={(k) => t(DISTANCE_BUCKET_KEYS[k]?.[0] ?? "noData")}
        labelShort={(k) => t(DISTANCE_BUCKET_KEYS[k]?.[1] ?? "noData")}
        tableColumns={1}
        t={t}
      />
    </section>
  );
}

type PeakGranularity = "minute" | "hour" | "day" | "week" | "month" | "year";

function PeakBucketsSection({
  peaks,
  t,
  locale,
}: {
  peaks: {
    minute: PeakBucket | null;
    hour: PeakBucket | null;
    day: PeakBucket | null;
    week: PeakBucket | null;
    month: PeakBucket | null;
    year: PeakBucket | null;
  };
  t: StatsT;
  locale: string;
}) {
  const anyPeak =
    peaks.minute ||
    peaks.hour ||
    peaks.day ||
    peaks.week ||
    peaks.month ||
    peaks.year;
  if (!anyPeak) return null;

  const cards: ReadonlyArray<{
    granularity: PeakGranularity;
    label: string;
    icon: LucideIcon;
    peak: PeakBucket | null;
  }> = [
    {
      granularity: "minute",
      label: t("peakMinute"),
      icon: Timer,
      peak: peaks.minute,
    },
    {
      granularity: "hour",
      label: t("peakHour"),
      icon: Clock,
      peak: peaks.hour,
    },
    {
      granularity: "day",
      label: t("peakDay"),
      icon: Calendar,
      peak: peaks.day,
    },
    {
      granularity: "week",
      label: t("peakWeek"),
      icon: CalendarRange,
      peak: peaks.week,
    },
    {
      granularity: "month",
      label: t("peakMonth"),
      icon: CalendarDays,
      peak: peaks.month,
    },
    {
      granularity: "year",
      label: t("peakYear"),
      icon: Sparkles,
      peak: peaks.year,
    },
  ];
  return (
    <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map(({ granularity, label, icon, peak }) => (
        <PeakBucketCard
          key={granularity}
          granularity={granularity}
          label={label}
          icon={icon}
          peak={peak}
          t={t}
          locale={locale}
        />
      ))}
    </section>
  );
}

function PeakBucketCard({
  granularity,
  label,
  icon: Icon,
  peak,
  t,
  locale,
}: {
  granularity: PeakGranularity;
  label: string;
  icon: LucideIcon;
  peak: PeakBucket | null;
  t: StatsT;
  locale: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-brand-700" aria-hidden />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {label}
        </h3>
      </div>
      {peak ? (
        <>
          <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900">
            {peak.count}
            <span className="ml-1 text-sm font-normal text-gray-500">
              {t("labelFinds", { count: peak.count })}
            </span>
          </p>
          <p className="mt-1 text-xs leading-snug text-gray-600">
            {formatPeakBucket(peak.startsAt, granularity, locale)}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-gray-400">—</p>
      )}
    </div>
  );
}

function formatPeakBucket(
  isoStart: string,
  granularity: PeakGranularity,
  locale: string,
): string {
  const intlLocale = toIntlLocale(locale);
  const start = new Date(isoStart);
  const intl = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(intlLocale, opts).format(start);

  switch (granularity) {
    case "minute": {
      const day = intl({ day: "numeric", month: "long", year: "numeric" });
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${day}, ${pad(start.getHours())}:${pad(start.getMinutes())}`;
    }
    case "hour": {
      const day = intl({ day: "numeric", month: "long", year: "numeric" });
      const h = start.getHours();
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${day}, ${pad(h)}:00–${pad(h)}:59`;
    }
    case "day":
      return intl({
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    case "week": {
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const sameMonth =
        start.getFullYear() === end.getFullYear() &&
        start.getMonth() === end.getMonth();
      const sameYear = start.getFullYear() === end.getFullYear();
      const startFmt = sameMonth
        ? new Intl.DateTimeFormat(intlLocale, { day: "numeric" }).format(start)
        : sameYear
          ? new Intl.DateTimeFormat(intlLocale, {
              day: "numeric",
              month: "long",
            }).format(start)
          : new Intl.DateTimeFormat(intlLocale, {
              day: "numeric",
              month: "long",
              year: "numeric",
            }).format(start);
      const endFmt = new Intl.DateTimeFormat(intlLocale, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(end);
      return `${startFmt}–${endFmt}`;
    }
    case "month":
      return intl({ month: "long", year: "numeric" });
    case "year":
      return intl({ year: "numeric" });
  }
}

function JubileeFindsSection({
  jubilees,
  t,
  locale,
}: {
  jubilees: readonly JubileeFind[];
  t: StatsT;
  locale: string;
}) {
  if (jubilees.length === 0) return null;
  const specialSet = new Set<number>();
  for (let r = 111; r <= 1_000_000; r = r * 10 + 1) specialSet.add(r);
  specialSet.add(666);
  specialSet.add(6666);
  const milestones = jubilees.filter((j) => !specialSet.has(j.id));
  const SLOTTED_SPECIALS = [111, 666, 1111, 6666, 11111] as const;
  const SLOTTED_THOUSANDS = Array.from(
    { length: 10 },
    (_, i) => (i + 1) * 1000,
  );
  type Slot =
    | { kind: "find"; find: JubileeFind }
    | { kind: "empty"; id: number };
  const jubileeById = new Map(jubilees.map((j) => [j.id, j]));
  const buildSlots = (ids: readonly number[]): readonly Slot[] =>
    ids.map((id) => {
      const find = jubileeById.get(id);
      return find ? { kind: "find", find } : { kind: "empty", id };
    });
  const slottedSpecials = buildSlots(SLOTTED_SPECIALS);
  const slottedMilestones = buildSlots(SLOTTED_THOUSANDS);
  const hiddenMilestones = milestones.filter(
    (m) => !SLOTTED_THOUSANDS.includes(m.id),
  );

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
      <header>
        <h2 className="text-lg font-semibold text-gray-900">
          {t("jubileeHeading")}
        </h2>
        <p className="text-sm text-gray-500">{t("jubileeSubtitle")}</p>
      </header>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {slottedSpecials.map((slot) =>
          slot.kind === "find" ? (
            <li key={slot.find.id}>
              <JubileeCard find={slot.find} variant="special" t={t} locale={locale} />
            </li>
          ) : (
            <li key={`empty-${slot.id}`}>
              <JubileeEmptyCard id={slot.id} variant="special" t={t} />
            </li>
          ),
        )}
      </ul>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {slottedMilestones.map((slot) =>
          slot.kind === "find" ? (
            <li key={slot.find.id}>
              <JubileeCard find={slot.find} t={t} locale={locale} />
            </li>
          ) : (
            <li key={`empty-${slot.id}`}>
              <JubileeEmptyCard id={slot.id} t={t} />
            </li>
          ),
        )}
      </ul>

      {hiddenMilestones.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer justify-center [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:border-brand-200 hover:text-brand-700">
              <span className="group-open:hidden">
                {t("jubileeShowMore", { count: hiddenMilestones.length })}
              </span>
              <span className="hidden group-open:inline">
                {t("jubileeHideMore")}
              </span>
            </span>
          </summary>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {hiddenMilestones.map((j) => (
              <li key={j.id}>
                <JubileeCard find={j} t={t} locale={locale} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function JubileeCard({
  find,
  variant = "default",
  t,
  locale,
}: {
  find: JubileeFind;
  variant?: "default" | "special";
  t: StatsT;
  locale: string;
}) {
  const date = find.foundAt ? new Date(find.foundAt) : null;
  const showMapLink = !find.isAnonymized && find.hasGps;
  const isSpecial = variant === "special";
  return (
    <div
      className={`flex h-full flex-col rounded-md border transition hover:shadow-sm ${
        isSpecial
          ? "border-brand-200 bg-brand-50/60 hover:border-brand-300 hover:bg-brand-50"
          : "border-gray-200 bg-gray-50 hover:border-brand-200 hover:bg-brand-50"
      }`}
    >
      <Link
        href={`/sbirka/${find.id}`}
        className="flex flex-1 flex-col gap-1 p-3 text-sm"
      >
        <span className="inline-flex items-center gap-1 font-mono text-base font-semibold text-brand-700">
          {isSpecial && (
            <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden />
          )}
          #{find.id}
        </span>
        {find.isAnonymized ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-purple-800 self-start">
            <HelpCircle className="h-3 w-3" aria-hidden />
            {t("jubileeAnonymized")}
          </span>
        ) : (
          <>
            <span className="text-xs text-gray-500">
              {date ? formatDateTimeCs(date, locale) : t("jubileeUnknownDate")}
            </span>
            {find.location && (
              <span
                className="truncate font-mono text-xs text-gray-700"
                title={find.location.displayName}
              >
                {find.location.code}
              </span>
            )}
          </>
        )}
      </Link>
      {showMapLink && (
        <Link
          href={`/mapa?find=${find.id}`}
          className="flex items-center justify-center gap-1 border-t border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:bg-brand-100 hover:text-brand-700"
          aria-label={t("showFindOnMapAria", { id: find.id })}
          title={t("showOnMapTitle")}
        >
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          {t("showOnMapLabel")}
        </Link>
      )}
    </div>
  );
}

function JubileeEmptyCard({
  id,
  variant = "default",
  t,
}: {
  id: number;
  variant?: "default" | "special";
  t: StatsT;
}) {
  const isSpecial = variant === "special";
  return (
    <div
      className={`flex h-full flex-col items-center justify-center rounded-md border border-dashed px-3 py-4 text-center ${
        isSpecial
          ? "border-brand-200 bg-brand-50/40"
          : "border-gray-300 bg-gray-50/60"
      }`}
      aria-label={t("jubileeMissingAria", { id })}
    >
      <span
        className={`inline-flex items-center gap-1 font-mono text-base font-semibold ${
          isSpecial ? "text-brand-700/60" : "text-gray-400"
        }`}
      >
        {isSpecial && (
          <Sparkles
            className="h-3.5 w-3.5 text-amber-500/70"
            aria-hidden
          />
        )}
        #{id}
      </span>
      <span
        className={`mt-1 text-[11px] uppercase tracking-wide ${
          isSpecial ? "text-brand-700/60" : "text-gray-400"
        }`}
      >
        {t("jubileeMissing")}
      </span>
    </div>
  );
}
