import type { Metadata } from "next";
import { Archive, X } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LocationsFilterBar } from "@/components/locations/locations-filter-bar";
import { LocationsToolbar } from "@/components/locations/locations-toolbar";
import { LocationListRow } from "@/components/locations/location-list-row";
import {
  listCadastralAreas,
  listCountries,
  listLocations,
  type LocationSort,
} from "@/lib/queries/locations";
import { cityFromCadastralArea } from "@/lib/locationCode";
import { localizedCountryName } from "@/lib/world-countries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Lokality");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

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
  "newest",
  "code",
  "dist-asc",
  "dist-desc",
];

function parseSort(v: string | undefined): LocationSort {
  return SORT_VALUES.find((s) => s === v) ?? "finds";
}

export default async function LokalityPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const t = await getTranslations("Lokality");
  const q = pickString(sp.q) ?? "";
  // Normalize via cityFromCadastralArea so a stale URL with
  // `?city=NEEXISTUJE-ZLÍN` is treated as `?city=ZLÍN` — both the
  // dropdown selection and the query layer agree on the canonical
  // form. See cityFromCadastralArea() in lib/locationCode for the
  // why ("NEEXISTUJE-" marks the location as gone, not a separate
  // city bucket).
  const city = cityFromCadastralArea(pickString(sp.city));
  const country = pickString(sp.country) ?? "";
  const sort = parseSort(pickString(sp.sort));
  const showAnonymized = pickString(sp.showAnon) === "1";
  const onlyGone = pickString(sp.onlyGone) === "1";
  const showGone = onlyGone || pickString(sp.showGone) === "1";
  const hasRealPhoto = pickString(sp.hasPhoto) === "1";

  const locale = await getLocale();
  const [cities, countriesRaw, locations] = await Promise.all([
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

  // Country names from listCountries are raw English (Natural Earth).
  // Localize at the page boundary so the dropdown renders the user's
  // language while the upstream query stays cache-shareable across
  // locales.
  const countries = countriesRaw
    .map((c) => ({ code: c.code, name: localizedCountryName(c.name, locale) }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, locale === "en" ? "en" : "cs"),
    );

  const filterActive =
    !!q || !!city || !!country || sort !== "finds" || showAnonymized
      || showGone || hasRealPhoto || onlyGone;
  const summarySuffix = filterActive ? "filtered" : "total";

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">{t("h1")}</h1>
        <p className="text-gray-600">
          {t("summary", {
            count: locations.length,
            withSuffix: summarySuffix,
          })}
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
          hasFilters: filterActive,
        }}
      />

      {onlyGone && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          <span className="inline-flex items-center gap-2">
            <Archive className="h-4 w-4" aria-hidden />
            <span>
              {t.rich("onlyGoneBanner", {
                count: locations.length,
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
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
            <span>{t("onlyGoneClear")}</span>
          </Link>
        </div>
      )}

      {locations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-12 text-center">
          <p className="text-gray-500">{t("noLocationsMatch")}</p>
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
