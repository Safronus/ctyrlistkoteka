import type { Metadata } from "next";
import Link from "next/link";
import { Map } from "lucide-react";
import { FindState } from "@prisma/client";
import { CollectionProgressBanner } from "@/components/finds/collection-progress-banner";
import { FilterBar } from "@/components/finds/filter-bar";
import { RememberSbirkaSearch } from "@/components/finds/sbirka-back-link";
import { FindGrid } from "@/components/finds/find-grid";
import { FindList } from "@/components/finds/find-list";
import {
  ViewSortToolbar,
  type FindView,
} from "@/components/finds/view-sort-toolbar";
import { Pagination } from "@/components/finds/pagination";
import { FINDS_PER_PAGE } from "@/lib/constants";
import {
  getCollectionProgress,
  getFilterOptions,
  listFinds,
  type FindFilters,
  type FindSort,
} from "@/lib/queries/finds";
import { formatCount, FINDS as FINDS_FORMS } from "@/lib/format";

export const metadata: Metadata = {
  title: "Sbírka",
  description: "Galerie všech nálezů čtyřlístků s filtry a hledáním.",
};

// SSR — filters come from URL, so revalidation isn't useful. Each request
// runs the Prisma query. Fine for desktop-sized concurrency on this site.
export const dynamic = "force-dynamic";

function parseInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function parseDateOnly(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function dateToString(d: Date | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

function parseState(value: string | undefined): FindState | undefined {
  if (!value) return undefined;
  return (Object.values(FindState) as string[]).includes(value)
    ? (value as FindState)
    : undefined;
}

function parseSort(value: string | undefined): FindSort {
  if (value === "asc") return "asc";
  if (value === "dist-asc") return "dist-asc";
  if (value === "dist-desc") return "dist-desc";
  return "desc";
}

function parseView(value: string | undefined): FindView {
  return value === "grid" ? "grid" : "list";
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pickString(
  v: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function SbirkaPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const filters: FindFilters = {
    q: pickString(sp.q) ?? undefined,
    locationId: parseInt(pickString(sp.loc)),
    cadastralArea: pickString(sp.city) || undefined,
    country: pickString(sp.country) || undefined,
    state: parseState(pickString(sp.state)),
    year: parseInt(pickString(sp.year)),
    dateFrom: parseDateOnly(pickString(sp.from)),
    dateTo: parseDateOnly(pickString(sp.to)),
  };
  const page = parseInt(pickString(sp.page)) ?? 1;
  const sort = parseSort(pickString(sp.sort));
  const view = parseView(pickString(sp.view));

  const [options, result, progress] = await Promise.all([
    getFilterOptions(),
    listFinds(filters, page, FINDS_PER_PAGE, sort),
    getCollectionProgress(),
  ]);

  const hasFilters = !!(
    filters.q ||
    filters.locationId ||
    filters.cadastralArea ||
    filters.country ||
    filters.state ||
    filters.year ||
    filters.dateFrom ||
    filters.dateTo
  );

  // /mapa accepts the same filter param shape (q, loc, city, country,
  // state, year, from, to) — copy the active filters across so the map
  // page can resolve the same find ID set and dim everything outside it.
  const buildMapHref = (f: typeof filters) => {
    const params = new URLSearchParams();
    if (f.q) params.set("q", f.q);
    if (f.locationId) params.set("loc", String(f.locationId));
    if (f.cadastralArea) params.set("city", f.cadastralArea);
    if (f.country) params.set("country", f.country);
    if (f.state) params.set("state", f.state);
    if (f.year) params.set("year", String(f.year));
    if (f.dateFrom) params.set("from", dateToString(f.dateFrom));
    if (f.dateTo) params.set("to", dateToString(f.dateTo));
    const qs = params.toString();
    return qs ? `/mapa?${qs}` : "/mapa";
  };

  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.locationId) params.set("loc", String(filters.locationId));
    if (filters.cadastralArea) params.set("city", filters.cadastralArea);
    if (filters.country) params.set("country", filters.country);
    if (filters.state) params.set("state", filters.state);
    if (filters.year) params.set("year", String(filters.year));
    if (filters.dateFrom) params.set("from", dateToString(filters.dateFrom));
    if (filters.dateTo) params.set("to", dateToString(filters.dateTo));
    if (sort !== "desc") params.set("sort", sort);
    if (view !== "list") params.set("view", view);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/sbirka?${qs}` : "/sbirka";
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <RememberSbirkaSearch />
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Sbírka nálezů</h1>
        <p className="text-gray-600">
          {formatCount(result.total, FINDS_FORMS)}
          {result.total !== 0 && " celkem"}
        </p>
      </header>

      {!hasFilters && (
        <CollectionProgressBanner
          count={progress.count}
          minFindId={progress.minFindId}
          maxFindId={progress.maxFindId}
          gaps={progress.gaps}
        />
      )}

      <FilterBar
        options={options}
        current={{
          q: filters.q ?? "",
          locationId: filters.locationId ? String(filters.locationId) : "",
          city: filters.cadastralArea ?? "",
          country: filters.country ?? "",
          state: filters.state ?? "",
          year: filters.year ? String(filters.year) : "",
        }}
      />

      {hasFilters && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-sm text-brand-900">
          <span>
            Filtr je aktivní —{" "}
            <strong className="font-semibold">
              {result.total.toLocaleString("cs-CZ")}
            </strong>{" "}
            {result.total === 1
              ? "nález"
              : result.total < 5
                ? "nálezy"
                : "nálezů"}{" "}
            odpovídá filtru.
          </span>
          <Link
            href={buildMapHref(filters)}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-white px-3 py-1.5 text-sm font-medium text-brand-800 shadow-sm transition hover:border-brand-500 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          >
            <Map className="h-4 w-4" aria-hidden />
            <span>Zobrazit na mapě</span>
          </Link>
        </div>
      )}

      <ViewSortToolbar
        view={view}
        sort={sort}
        dateFrom={dateToString(filters.dateFrom)}
        dateTo={dateToString(filters.dateTo)}
        minDate={options.minDate}
        maxDate={options.maxDate}
      />

      {view === "list" ? (
        <FindList finds={result.items} />
      ) : (
        <FindGrid finds={result.items} />
      )}

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        makeHref={buildHref}
      />
    </div>
  );
}
