import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  ExternalLink,
  Globe,
  Link2,
  MonitorSmartphone,
} from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import {
  getVisitorsBrowsers,
  getVisitorsDaily,
  getVisitorsLocations,
  getVisitorsTopPaths,
  getVisitorsTopRefs,
  getVisitorsTotal,
  isGoatCounterConfigured,
  visitorsPeriodRange,
  VISITORS_PERIOD_LABELS,
  VISITORS_PERIODS,
  type TopPath,
  type TopRef,
  type VisitorsPeriod,
  type VisitorsTotal,
} from "@/lib/queries/visitorStats";
import { VisitorsDailyChart } from "./visitors-daily-chart";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function parsePeriod(raw: string | undefined): VisitorsPeriod {
  if (!raw) return "30d";
  return (VISITORS_PERIODS as readonly string[]).includes(raw)
    ? (raw as VisitorsPeriod)
    : "30d";
}

const CS_NUM = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 });

export default async function AdminVisitorsPage({ searchParams }: PageProps) {
  await ensureAdminAuth();
  const sp = await searchParams;
  const periodRaw = Array.isArray(sp.period) ? sp.period[0] : sp.period;
  const period = parsePeriod(periodRaw);
  const configured = isGoatCounterConfigured();
  const range = visitorsPeriodRange(period);
  const gcDashboardUrl = process.env.GOATCOUNTER_API_URL ?? null;

  // Parallel fetch — every helper degrades to null/[] on failure so a
  // single endpoint outage doesn't take the whole page down. Tiles
  // for the four periods always fire so the operator can compare
  // even when zooming the chart in to a shorter window.
  const [
    total7d,
    total30d,
    total365d,
    totalAll,
    daily,
    topPaths,
    topRefs,
    browsers,
    locations,
  ] = await Promise.all([
    getVisitorsTotal("7d"),
    getVisitorsTotal("30d"),
    getVisitorsTotal("365d"),
    getVisitorsTotal("all"),
    getVisitorsDaily(period),
    getVisitorsTopPaths(period, 15),
    getVisitorsTopRefs(period, 10),
    getVisitorsBrowsers(period, 8),
    getVisitorsLocations(period, 10),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 hover:text-gray-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Přehled
        </Link>
        <span aria-hidden>/</span>
        <span className="text-gray-900">Návštěvnost</span>
      </div>

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">Návštěvnost</h1>
          <p className="text-sm text-gray-500">
            Data z GoatCounteru na{" "}
            <code className="font-mono">stats.ctyrlistkoteka.cz</code>. Zdroj
            pravdy zůstává tam — tato stránka jen čte přes API. Sledování
            běží od{" "}
            <code className="font-mono">{range.start}</code> (případně{" "}
            <code className="font-mono">VISIT_TRACKING_START</code> pro
            celkový součet).
          </p>
        </div>
        {gcDashboardUrl && (
          <a
            href={gcDashboardUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:border-gray-400 hover:bg-gray-50"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Otevřít GoatCounter dashboard
          </a>
        )}
      </header>

      {!configured && <NotConfiguredBanner />}

      {configured && (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <TotalTile label="Posledních 7 dní" data={total7d} />
            <TotalTile label="Posledních 30 dní" data={total30d} />
            <TotalTile label="Posledních 365 dní" data={total365d} />
            <TotalTile label="Vše" data={totalAll} />
          </section>

          <PeriodToggle current={period} />

          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <header className="mb-2 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-brand-600" aria-hidden />
              <h2 className="text-sm font-semibold text-gray-900">
                Denní zobrazení a návštěvníci ·{" "}
                {VISITORS_PERIOD_LABELS[period].toLowerCase()}
              </h2>
            </header>
            <div className="h-64 w-full">
              <VisitorsDailyChart data={daily} />
            </div>
            <p className="mt-2 text-[11px] text-gray-500">
              Sloupec = počet zobrazení daný den. Najetím myší zobrazíš i
              počet unikátních návštěvníků (jeden návštěvník může mít víc
              zobrazení).
            </p>
          </section>

          <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <TopPathsCard
              paths={topPaths}
              periodLabel={VISITORS_PERIOD_LABELS[period]}
            />
            <TopRefsCard
              refs={topRefs}
              periodLabel={VISITORS_PERIOD_LABELS[period]}
            />
          </section>

          <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <SmallStatCard
              icon={MonitorSmartphone}
              title="Prohlížeče"
              rows={browsers}
              periodLabel={VISITORS_PERIOD_LABELS[period]}
            />
            <SmallStatCard
              icon={Globe}
              title="Země návštěvníků"
              rows={locations}
              periodLabel={VISITORS_PERIOD_LABELS[period]}
            />
          </section>
        </>
      )}
    </div>
  );
}

function NotConfiguredBanner() {
  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50/60 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-2 text-sm text-amber-900">
          <h2 className="font-semibold">GoatCounter API není nastavený</h2>
          <p className="text-xs leading-relaxed">
            Stránka načítá data z GoatCounteru přes{" "}
            <code className="font-mono">/api/v0/stats/*</code>. Aby se
            čísla zobrazila, nastav v <code className="font-mono">.env</code>{" "}
            na VPS:
          </p>
          <pre className="overflow-x-auto rounded border border-amber-300 bg-white px-3 py-2 font-mono text-[11px] text-amber-900">
            GOATCOUNTER_API_URL=https://stats.ctyrlistkoteka.cz
            {"\n"}
            GOATCOUNTER_API_KEY=&lt;token vygenerovaný v GC →
            Settings → API tokens&gt;
          </pre>
          <p className="text-[11px] text-amber-900/80">
            Token potřebuje práva <code className="font-mono">read</code>{" "}
            (Read statistics). Po zápisu do <code>.env</code> stačí
            restartovat PM2 (Sync → Restartovat PM2).
          </p>
        </div>
      </div>
    </section>
  );
}

function TotalTile({
  label,
  data,
}: {
  label: string;
  data: VisitorsTotal | null;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-brand-50 p-4 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-brand-700 sm:text-3xl">
        {data ? CS_NUM.format(data.total) : "—"}
      </p>
      <p className="mt-0.5 text-[11px] text-gray-500">
        {data
          ? `${CS_NUM.format(data.totalUnique)} návštěvníků`
          : "API nedostupné"}
      </p>
    </div>
  );
}

function PeriodToggle({ current }: { current: VisitorsPeriod }) {
  return (
    <nav
      aria-label="Volba období"
      className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 text-xs"
    >
      {VISITORS_PERIODS.map((p) => {
        const active = p === current;
        return (
          <Link
            key={p}
            href={p === "30d" ? "/admin/visitors" : `/admin/visitors?period=${p}`}
            className={
              active
                ? "rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white"
                : "rounded-md px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100"
            }
          >
            {VISITORS_PERIOD_LABELS[p]}
          </Link>
        );
      })}
    </nav>
  );
}

function TopPathsCard({
  paths,
  periodLabel,
}: {
  paths: readonly TopPath[];
  periodLabel: string;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
          <BarChart3 className="h-4 w-4 text-brand-600" aria-hidden />
          Nejnavštěvovanější stránky
        </h2>
        <span className="text-[11px] text-gray-500">{periodLabel}</span>
      </header>
      {paths.length === 0 ? (
        <p className="text-xs text-gray-500">Žádná data.</p>
      ) : (
        <ol className="space-y-1">
          {paths.map((p) => (
            <li
              key={p.path}
              className="flex items-baseline gap-2 rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5 text-xs"
            >
              <code className="min-w-0 flex-1 truncate font-mono text-gray-900">
                {p.path}
              </code>
              {p.title && (
                <span
                  className="hidden shrink-0 max-w-[40%] truncate text-gray-500 sm:inline"
                  title={p.title}
                >
                  {p.title}
                </span>
              )}
              <span className="shrink-0 font-mono font-semibold tabular-nums text-brand-700">
                {CS_NUM.format(p.hits)}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-gray-500">
                ({CS_NUM.format(p.hitsUnique)})
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-[11px] text-gray-500">
        Číslo vlevo = zobrazení, v závorce unikátní návštěvníci.
      </p>
    </section>
  );
}

function TopRefsCard({
  refs,
  periodLabel,
}: {
  refs: readonly TopRef[];
  periodLabel: string;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Link2 className="h-4 w-4 text-brand-600" aria-hidden />
          Odkud přicházejí
        </h2>
        <span className="text-[11px] text-gray-500">{periodLabel}</span>
      </header>
      {refs.length === 0 ? (
        <p className="text-xs text-gray-500">
          Žádné zdroje — nebo všichni přišli přímo (bookmark / direct).
        </p>
      ) : (
        <ol className="space-y-1">
          {refs.map((r) => (
            <li
              key={r.name}
              className="flex items-baseline gap-2 rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5 text-xs"
            >
              <span className="min-w-0 flex-1 truncate text-gray-900">
                {r.name}
              </span>
              <span className="shrink-0 font-mono font-semibold tabular-nums text-brand-700">
                {CS_NUM.format(r.hits)}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-gray-500">
                ({CS_NUM.format(r.hitsUnique)})
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function SmallStatCard({
  icon: Icon,
  title,
  rows,
  periodLabel,
}: {
  icon: typeof BarChart3;
  title: string;
  rows: readonly TopRef[];
  periodLabel: string;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Icon className="h-4 w-4 text-brand-600" aria-hidden />
          {title}
        </h2>
        <span className="text-[11px] text-gray-500">{periodLabel}</span>
      </header>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500">Žádná data.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li
              key={r.name}
              className="flex items-baseline gap-2 rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5 text-xs"
            >
              <span className="min-w-0 flex-1 truncate text-gray-900">
                {r.name}
              </span>
              <span className="shrink-0 font-mono font-semibold tabular-nums text-brand-700">
                {CS_NUM.format(r.hits)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
