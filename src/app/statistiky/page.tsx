import type { Metadata } from "next";
import Link from "next/link";
import { HelpCircle } from "lucide-react";
import {
  formatDateTimeCs,
  formatLocationId,
  formatTimeSinceCs,
} from "@/lib/format";
import {
  getCollectionStats,
  type FindHighlight,
} from "@/lib/queries/stats";

export const metadata: Metadata = {
  title: "Statistiky",
  description: "Přehled sbírky čtyřlístků v číslech.",
};

// Matches STATS_REVALIDATE in src/lib/constants.ts (6 hours).
export const revalidate = 21600;

export default async function StatistikyPage() {
  const stats = await getCollectionStats();
  const { totals, firstFind, lastFind } = stats;
  const fmt = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 });

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-3xl font-bold text-gray-900">Statistiky</h1>
        <p className="mt-2 text-gray-600">Souhrn sbírky.</p>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TotalCard label="nálezů" value={fmt.format(totals.finds)} />
        <TotalCard label="lokalit" value={fmt.format(totals.locations)} />
      </section>

      {(firstFind || lastFind) && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {firstFind && <FindHighlightCard label="První nález" find={firstFind} />}
          {lastFind && lastFind.id !== firstFind?.id && (
            <FindHighlightCard label="Poslední nález" find={lastFind} />
          )}
        </section>
      )}
    </div>
  );
}

function TotalCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
      <p className="text-4xl font-bold text-brand-700">{value}</p>
      <p className="mt-1 text-sm text-gray-500">{label}</p>
    </div>
  );
}

function FindHighlightCard({
  label,
  find,
}: {
  label: string;
  find: FindHighlight;
}) {
  const date = find.foundAt ? new Date(find.foundAt) : null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          {label}
        </h2>
        <span className="font-mono text-xs text-gray-500">
          {formatLocationId(find.id)}
        </span>
      </div>

      <p className="mt-2 text-base font-semibold text-gray-900">
        {date ? formatDateTimeCs(date) : "Datum nálezu chybí"}
      </p>
      {date && (
        <p className="text-xs text-gray-500">{formatTimeSinceCs(date)}</p>
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
            Anonymizovaná lokalita
          </p>
        )}
      </div>

      <Link
        href={`/sbirka/${find.id}`}
        className="mt-4 inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
      >
        Otevřít nález #{find.id} →
      </Link>
    </div>
  );
}
