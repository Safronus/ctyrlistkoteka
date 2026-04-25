import type { Metadata } from "next";
import { LocationsFilterBar } from "@/components/locations/locations-filter-bar";
import { LocationListRow } from "@/components/locations/location-list-row";
import {
  listCadastralAreas,
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

const SORT_VALUES: readonly LocationSort[] = ["id", "code", "finds"];

function parseSort(v: string | undefined): LocationSort {
  return SORT_VALUES.find((s) => s === v) ?? "id";
}

export default async function LokalityPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = pickString(sp.q) ?? "";
  const city = pickString(sp.city) ?? "";
  const sort = parseSort(pickString(sp.sort));
  // Both visibility toggles are opt-in — empty/absent means hidden.
  const showAnonymized = pickString(sp.showAnon) === "1";
  const showGone = pickString(sp.showGone) === "1";

  const [cities, locations] = await Promise.all([
    listCadastralAreas(),
    listLocations({
      q: q || undefined,
      cadastralArea: city || undefined,
      sort,
      showAnonymized,
      showGone,
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
        current={{ q, city, sort, showAnonymized, showGone }}
      />

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
