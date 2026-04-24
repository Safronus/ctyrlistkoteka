import type { Metadata } from "next";
import { FindState } from "@prisma/client";
import { ChartCard } from "@/components/stats/chart-card";
import {
  CategoryPieChart,
  LeafDistributionChart,
  MonthlyLineChart,
  TopLocationsChart,
  YearlyBarChart,
} from "@/components/stats/charts-dynamic";
import { formatCount, FINDS, LOCATIONS } from "@/lib/format";
import { getCollectionStats } from "@/lib/queries/stats";
import { STATE_LABELS } from "@/lib/stateLabels";

export const metadata: Metadata = {
  title: "Statistiky",
  description: "Přehled sbírky čtyřlístků v číslech a grafech.",
};

// Matches STATS_REVALIDATE in src/lib/constants.ts (6 hours).
export const revalidate = 21600;

export default async function StatistikyPage() {
  const stats = await getCollectionStats();
  const { totals } = stats;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-3xl font-bold text-gray-900">Statistiky</h1>
        <p className="mt-2 text-gray-600">
          Souhrn sbírky v číslech a grafech.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <TotalCard
          label={formatCount(totals.finds, FINDS).split(" ")[1] ?? "nálezů"}
          value={totals.finds}
        />
        <TotalCard
          label={formatCount(totals.locations, LOCATIONS).split(" ")[1] ?? "lokalit"}
          value={totals.locations}
        />
        <TotalCard label="s fotkou" value={totals.photographed} />
        <TotalCard label="anonymizovaných" value={totals.anonymized} />
        <TotalCard
          label="průměr lístků"
          value={totals.averageLeaves}
          fractional
        />
        <TotalCard
          label="max. lístků"
          value={totals.maxLeaves ?? 0}
        />
      </section>

      {totals.firstYear !== null && totals.lastYear !== null && (
        <p className="text-sm text-gray-500">
          Rozsah let: {totals.firstYear}–{totals.lastYear}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Nálezy v čase"
          description="Počet nálezů podle měsíce nálezu (z EXIF)"
          className="lg:col-span-2"
        >
          <MonthlyLineChart data={stats.monthly} />
        </ChartCard>

        <ChartCard title="Nálezy podle roku">
          <YearlyBarChart data={stats.yearly} />
        </ChartCard>

        <ChartCard title="Rozložení počtu lístků">
          <LeafDistributionChart data={stats.leafDistribution} />
        </ChartCard>

        <ChartCard
          title="Top lokality"
          description="Nejpilnější místa nálezů"
          className="lg:col-span-2"
        >
          <TopLocationsChart data={stats.topLocations} />
        </ChartCard>

        <ChartCard title="Typy prostředí">
          <CategoryPieChart data={stats.locationTypes} />
        </ChartCard>

        <ChartCard title="Stavy nálezů">
          <CategoryPieChart
            data={stats.states.map((s) => ({
              ...s,
              name: STATE_LABELS[s.name as FindState] ?? s.name,
            }))}
          />
        </ChartCard>
      </div>
    </div>
  );
}

function TotalCard({
  label,
  value,
  fractional = false,
}: {
  label: string;
  value: number;
  fractional?: boolean;
}) {
  const fmt = new Intl.NumberFormat("cs-CZ", {
    maximumFractionDigits: fractional ? 2 : 0,
  });
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
      <p className="text-2xl font-bold text-brand-700">{fmt.format(value)}</p>
      <p className="mt-0.5 text-xs text-gray-500">{label}</p>
    </div>
  );
}
