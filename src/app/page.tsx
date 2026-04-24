import Link from "next/link";
import { getCollectionTotals } from "@/lib/queries/finds";
import { formatCount, FINDS, LOCATIONS, YEARS } from "@/lib/format";

// Must be a literal for Next.js static analysis. Matches HOME_REVALIDATE in
// src/lib/constants.ts (1 hour).
export const revalidate = 3600;

export default async function HomePage() {
  const totals = await getCollectionTotals();

  return (
    <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
      <section className="text-center">
        <p aria-hidden className="text-5xl">
          🍀
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
          Čtyřlístkotéka
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
          Veřejná prezentace soukromé sbírky čtyřlístků — tisíce nálezů,
          zaznamenaných lokalit a GPS souřadnic.
        </p>
      </section>

      <section className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={FINDS[2]}
          value={new Intl.NumberFormat("cs-CZ").format(totals.finds)}
        />
        <StatCard
          label={LOCATIONS[2]}
          value={new Intl.NumberFormat("cs-CZ").format(totals.locations)}
        />
        <StatCard
          label={totals.yearsSpan ? formatLabelFor(totals.yearsSpan, YEARS) : YEARS[2]}
          value={totals.yearsSpan ? String(totals.yearsSpan) : "—"}
        />
      </section>

      <section className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <NavCard
          href="/sbirka"
          title="Sbírka"
          description="Galerie všech nálezů s filtry, hledáním a detailem."
        />
        <NavCard
          href="/mapa"
          title="Mapa"
          description="Interaktivní mapa lokalit a konkrétních nálezů."
        />
        <NavCard
          href="/statistiky"
          title="Statistiky"
          description="Přehled sbírky v grafech a číslech."
        />
      </section>

      <p className="mt-6 text-center text-xs text-gray-400">
        {formatCount(totals.finds, FINDS)} ·{" "}
        {formatCount(totals.locations, LOCATIONS)}
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-brand-50 p-6 text-center">
      <p className="text-3xl font-bold text-brand-700">{value}</p>
      <p className="mt-1 text-sm text-gray-600">{label}</p>
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
      className="group rounded-xl border border-gray-200 bg-white p-6 transition hover:border-brand-200 hover:shadow-sm"
    >
      <h2 className="text-lg font-semibold text-gray-900 group-hover:text-brand-700">
        {title}
      </h2>
      <p className="mt-2 text-sm text-gray-600">{description}</p>
    </Link>
  );
}

function formatLabelFor(n: number, forms: readonly [string, string, string]): string {
  if (n === 1) return forms[0];
  if (n >= 2 && n <= 4) return forms[1];
  return forms[2];
}
