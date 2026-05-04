import type { Metadata } from "next";
import Link from "next/link";
import { Archive, X } from "lucide-react";
import { LocationsFilterBar } from "@/components/locations/locations-filter-bar";
import { LocationsToolbar } from "@/components/locations/locations-toolbar";
import { LocationListRow } from "@/components/locations/location-list-row";
import {
  listCadastralAreas,
  listCountries,
  listLocations,
  type LocationSort,
} from "@/lib/queries/locations";
import { formatCount, LOCATIONS } from "@/lib/format";

export const metadata: Metadata = {
  title: "Lokality",
  description:
    "Seznam všech lokačních map čtyřlístkové sbírky s filtry a souhrnnou statistikou nálezů.",
};

// Filters live in the URL, so revalidation isn't useful — let every
// request hit Prisma.
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pickString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

const SORT_VALUES: readonly LocationSort[] = [
  "finds",
  "id",
  "code",
  "dist-asc",
  "dist-desc",
];

function parseSort(v: string | undefined): LocationSort {
  // "finds" is the default — keep it stable with listLocations().
  return SORT_VALUES.find((s) => s === v) ?? "finds";
}

export default async function LokalityPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = pickString(sp.q) ?? "";
  const city = pickString(sp.city) ?? "";
  const country = pickString(sp.country) ?? "";
  const sort = parseSort(pickString(sp.sort));
  // Both visibility toggles are opt-in — empty/absent means hidden.
  const showAnonymized = pickString(sp.showAnon) === "1";
  // `onlyGone=1` is the deep-link from /statistiky — implies showGone
  // (the toolbar's visibility toggle) so the page reflects what the
  // visitor explicitly asked for. The query layer also forces it.
  const onlyGone = pickString(sp.onlyGone) === "1";
  const showGone = onlyGone || pickString(sp.showGone) === "1";
  const hasRealPhoto = pickString(sp.hasPhoto) === "1";

  const [cities, countries, locations] = await Promise.all([
    listCadastralAreas(),
    listCountries(),
    listLocations({
      q: q || undefined,
      cadastralArea: city || undefined,
      country: country || undefined,
      sort,
      showAnonymized,
      showGone,
      onlyGone: onlyGone || undefined,
      hasRealPhoto: hasRealPhoto || undefined,
    }),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Lokality</h1>
        <p className="text-gray-600">
          {formatCount(locations.length, LOCATIONS)}
          {locations.length !== cities.length || q ? " v aktuálním filtru" : " celkem"}
        </p>
      </header>

      <LocationsFilterBar
        cities={cities}
        countries={countries}
        current={{ q, city, country }}
      />

      <LocationsToolbar
        current={{
          sort,
          showAnonymized,
          showGone,
          hasRealPhoto,
          hasFilters:
            !!q ||
            !!city ||
            !!country ||
            sort !== "finds" ||
            showAnonymized ||
            showGone ||
            hasRealPhoto ||
            onlyGone,
        }}
      />

      {/* Active "pouze zaniklé" banner — surfaces the deep-link state
          from /statistiky so the visitor sees they're not on the
          unfiltered list. Dropping the param via the X preserves any
          other URL params the visitor has set (sort, country, …);
          showGone is also dropped to avoid leaving the toggle on
          unintentionally. */}
      {onlyGone && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          <span className="inline-flex items-center gap-2">
            <Archive className="h-4 w-4" aria-hidden />
            <span>
              Filtr: <strong>pouze zaniklé lokality</strong> ({locations.length}).
            </span>
          </span>
          <Link
            href={(() => {
              const params = new URLSearchParams();
              if (q) params.set("q", q);
              if (city) params.set("city", city);
              if (country) params.set("country", country);
              if (sort !== "finds") params.set("sort", sort);
              if (showAnonymized) params.set("showAnon", "1");
              if (hasRealPhoto) params.set("hasPhoto", "1");
              const qs = params.toString();
              return qs ? `/lokality?${qs}` : "/lokality";
            })()}
            className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-xs font-medium text-rose-800 transition hover:border-rose-300 hover:shadow-sm"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            <span>Zrušit filtr</span>
          </Link>
        </div>
      )}

      {locations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-12 text-center">
          <p className="text-gray-500">Žádné lokality neodpovídají filtrům.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white">
          {locations.map((location) => (
            <li key={location.id}>
              <LocationListRow location={location} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
