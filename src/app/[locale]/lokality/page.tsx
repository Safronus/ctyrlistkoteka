import type { Metadata } from "next";
import { Archive, X } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { HelpDialog } from "@/components/help/help-dialog";
import { FilterablePageHeader } from "@/components/filterable-page-header";
import { FilterActiveNotice } from "@/components/filter-active-notice";
import { LocationsFilterBar } from "@/components/locations/locations-filter-bar";
import { LocationsToolbar } from "@/components/locations/locations-toolbar";
import { LocationListRow } from "@/components/locations/location-list-row";
import {
  countAnonymizedAndFormerLocations,
  getLocationIdsWithRealPhotos,
  listLocations,
  type LocationSort,
} from "@/lib/queries/locations";
import { getCollectionProgress, getFilterOptions } from "@/lib/queries/finds";
import { buildFilterSummary } from "@/lib/filterSummary";
import { cityFromCadastralArea } from "@/lib/locationCode";
import { localizedCountryName } from "@/lib/world-countries";
import { localePath, ogLocale, seoAlternates } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations("Lokality");
  const title = t("metaTitle");
  const description = t("metaDescription");
  return {
    title,
    description,
    alternates: seoAlternates("/lokality", locale),
    openGraph: {
      title,
      description,
      locale: ogLocale(locale),
      url: localePath("/lokality", locale),
      images: [{ url: "/og", width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", images: ["/og"] },
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
  const tHelp = await getTranslations("LokalityHelp");
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
  // Rows to render pre-expanded. `?open=id,id2` is written by a row's toggle
  // (client, native replaceState — see LocationListRow.syncOpenParam) so
  // returning via Back after a click into a find / the map re-opens them.
  // Not a filter: it never touches the query, just seeds `defaultOpen`.
  const openIds = new Set(
    (pickString(sp.open) ?? "")
      .split(",")
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0),
  );

  const locale = await getLocale();
  const [filterOptions, locations, toggleCounts, realPhotoIds, progress] =
    await Promise.all([
      // Shared with /sbirka — its `cities` carry the country each sits in,
      // which the filter bar needs to cascade Stát → Město the same way.
      getFilterOptions(),
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
      countAnonymizedAndFormerLocations(),
      // Filter-independent count for the "S reálnou fotkou" toggle.
      getLocationIdsWithRealPhotos(),
      // Total find count for the filter-independent heading counts.
      getCollectionProgress(),
    ]);
  const totalFinds = progress.count;

  const cities = filterOptions.cities;
  // Country names from the shared options are raw English (Natural Earth).
  // Localize at the page boundary so the dropdown renders the user's
  // language while the upstream query stays cache-shareable across locales.
  const countries = filterOptions.countries
    .map((c) => ({ code: c.code, name: localizedCountryName(c.name, locale) }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, locale === "en" ? "en" : "cs"),
    );

  // How many locations fall under each country / city — shown in the filter
  // dropdowns. Derived from the full location set the shared options already
  // carry (each row has its city + country), so no extra query.
  const countryLocationCounts: Record<string, number> = {};
  const cityLocationCounts: Record<string, number> = {};
  for (const l of filterOptions.locations) {
    if (l.country)
      countryLocationCounts[l.country] =
        (countryLocationCounts[l.country] ?? 0) + 1;
    if (l.city)
      cityLocationCounts[l.city] = (cityLocationCounts[l.city] ?? 0) + 1;
  }

  // Any real FILTER (not sort — sort is presentation, matching /sbirka)
  // drives both the "Filtr je aktivní" notice and the "Zrušit filtry"
  // button. Sort is deliberately excluded so merely re-sorting doesn't
  // read as "filtered"; `clearAll` in the filter bar still keeps sort.
  const filterActive =
    !!q ||
    !!city ||
    !!country ||
    showAnonymized ||
    showGone ||
    hasRealPhoto ||
    onlyGone;

  // Human description of the active filters for the notice below the bar,
  // built with /sbirka's shared buildFilterSummary. Only q / city / country
  // apply here (the toggles read as pressed buttons in the toolbar), so the
  // state / location / date resolvers are never reached.
  const tSummary = await getTranslations("FilterSummary");
  const filterSummary = filterActive
    ? buildFilterSummary(
        {
          q: q || undefined,
          cadastralArea: city || undefined,
          country: country || undefined,
        },
        {
          t: tSummary as unknown as (
            k: string,
            v?: Record<string, string | number>,
          ) => string,
          stateLabel: (s) => s,
          locationLabel: () => "",
          countryLabel: (code) =>
            countries.find((c) => c.code === code)?.name ?? code,
          cityLabel: (name) => name,
          formatDay: (d) => d.toISOString(),
          formatInstant: (d) => d.toISOString(),
        },
      )
    : "";

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <FilterablePageHeader
        // Filter-independent totals pinned to the right of the title; the
        // per-filter count lives in the "Filtr je aktivní" strip below.
        counts={t("headingCounts", {
          locations: filterOptions.locations.length,
          anon: toggleCounts.anonymized,
          finds: totalFinds,
        })}
      >
        <h1 className="text-3xl font-bold text-gray-900">{t("h1")}</h1>
        {/* Help dialog button. MAINTENANCE: when you change the
            filters, sort options or anything else listed in the dialog,
            update the matching LokalityHelp.* keys in cs.json / en.json. */}
        <HelpDialog
            title={tHelp("modalTitle")}
            buttonTitle={tHelp("buttonTitle")}
            buttonAriaLabel={tHelp("buttonAria")}
            intro={tHelp("intro")}
            sections={[
              {
                heading: tHelp("sectionFiltersTitle"),
                items: [
                  tHelp("sectionFilters1"),
                  tHelp("sectionFilters2"),
                  tHelp("sectionFilters3"),
                ],
              },
              {
                heading: tHelp("sectionSortTitle"),
                items: [tHelp("sectionSort1")],
              },
              {
                heading: tHelp("sectionAnonGoneTitle"),
                items: [
                  tHelp("sectionAnonGone1"),
                  tHelp("sectionAnonGone2"),
                ],
              },
              {
                heading: tHelp("sectionExpandTitle"),
                items: [tHelp("sectionExpand1")],
              },
              {
                heading: tHelp("sectionDetailTitle"),
                items: [tHelp("sectionDetail1")],
              },
            ]}
          />
      </FilterablePageHeader>

      <LocationsFilterBar
        cities={cities}
        countries={countries}
        countryCounts={countryLocationCounts}
        cityCounts={cityLocationCounts}
        current={{ q, city, country }}
        hasFilters={filterActive}
      />

      {filterActive && (
        <FilterActiveNotice
          label={t("filterActive")}
          matches={t("filterMatches", { count: locations.length })}
          summary={filterSummary}
        />
      )}

      <LocationsToolbar
        current={{
          sort,
          showAnonymized,
          showGone,
          hasRealPhoto,
        }}
        anonymizedCount={toggleCounts.anonymized}
        formerCount={toggleCounts.former}
        realPhotoCount={realPhotoIds.size}
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
              <LocationListRow
                location={location}
                defaultOpen={openIds.has(location.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
