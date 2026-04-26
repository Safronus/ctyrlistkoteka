import type { Metadata } from "next";
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
    state: parseState(pickString(sp.state)),
    year: parseInt(pickString(sp.year)),
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
    filters.state ||
    filters.year
  );

  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.locationId) params.set("loc", String(filters.locationId));
    if (filters.state) params.set("state", filters.state);
    if (filters.year) params.set("year", String(filters.year));
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
        />
      )}

      <FilterBar
        options={options}
        current={{
          q: filters.q ?? "",
          locationId: filters.locationId ? String(filters.locationId) : "",
          state: filters.state ?? "",
          year: filters.year ? String(filters.year) : "",
        }}
      />

      <ViewSortToolbar view={view} sort={sort} />

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
