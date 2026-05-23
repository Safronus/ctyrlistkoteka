import type { Metadata } from "next";
import { Map as MapIcon } from "lucide-react";
import { FindState } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import { localizedCountryName } from "@/lib/world-countries";
import { Link } from "@/i18n/navigation";
import { CollectionProgressBanner } from "@/components/finds/collection-progress-banner";
import { FilterBar } from "@/components/finds/filter-bar";
import { RememberSbirkaSearch } from "@/components/finds/sbirka-back-link";
import { FindGrid } from "@/components/finds/find-grid";
import { FindList } from "@/components/finds/find-list";
import {
  ViewSortToolbar,
  type FindView,
} from "@/components/finds/view-sort-toolbar";
import { PageSizeSelector } from "@/components/finds/page-size-selector";
import { Pagination } from "@/components/finds/pagination";
import { FINDS_PER_PAGE } from "@/lib/constants";
import {
  getCollectionProgress,
  getFilterOptions,
  listFinds,
  type FindFilters,
  type FindSort,
} from "@/lib/queries/finds";
import {
  computeFingerprint,
  getFindVoteCounts,
  getVotedFindIds,
  readFingerprintInputs,
  readVoterUuid,
} from "@/lib/votes";

/** Allowed `?size=` values for /sbirka. 48 stays the default (matches
 *  FINDS_PER_PAGE); the larger options are deliberately the trio
 *  111/222/333 — playful repdigits riffing on the project's signature
 *  triples (#111, #666). The Pagination layout copes with any of
 *  these; the upper bound is bounded by how many find cards we want
 *  to ship in one HTML payload. */
const SBIRKA_PAGE_SIZES = [48, 111, 222, 333] as const;
type SbirkaPageSize = (typeof SBIRKA_PAGE_SIZES)[number];

function parseSbirkaPageSize(value: string | undefined): SbirkaPageSize {
  if (!value) return FINDS_PER_PAGE as SbirkaPageSize;
  const n = Number(value);
  return (SBIRKA_PAGE_SIZES as readonly number[]).includes(n)
    ? (n as SbirkaPageSize)
    : (FINDS_PER_PAGE as SbirkaPageSize);
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Sbirka");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

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
  if (value === "votes-desc") return "votes-desc";
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
  params: Promise<{ locale: string }>;
}

function pickString(
  v: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function SbirkaPage({ searchParams, params }: PageProps) {
  const sp = await searchParams;
  // Resolve `params` even though we don't read locale here — Next.js
  // requires the prop to be awaited if we declare it on PageProps.
  await params;
  const t = await getTranslations("Sbirka");

  const filters: FindFilters = {
    q: pickString(sp.q) ?? undefined,
    locationId: parseInt(pickString(sp.loc)),
    cadastralArea: pickString(sp.city) || undefined,
    country: pickString(sp.country) || undefined,
    state: parseState(pickString(sp.state)),
    year: parseInt(pickString(sp.year)),
    dateFrom: parseDateOnly(pickString(sp.from)),
    dateTo: parseDateOnly(pickString(sp.to)),
    hasRealPhoto: pickString(sp.hasPhoto) === "1" ? true : undefined,
  };
  const page = parseInt(pickString(sp.page)) ?? 1;
  const pageSize = parseSbirkaPageSize(pickString(sp.size));
  const sort = parseSort(pickString(sp.sort));
  const view = parseView(pickString(sp.view));

  const locale = await getLocale();
  const [optionsRaw, result, progress] = await Promise.all([
    getFilterOptions(),
    listFinds(filters, page, pageSize, sort),
    getCollectionProgress(),
  ]);

  // Pre-resolve "did this visitor already vote?" + counts for the
  // page of finds. Done at the SSR boundary so the rendered buttons
  // start in the correct state (no client flash). Cookie + fingerprint
  // are both checked — see src/lib/votes.ts for the OR-match rule.
  // Wrap the lookup in try/catch: a missing VOTE_FINGERPRINT_SALT
  // shouldn't crash /sbirka, just disables the per-row state.
  const findIdsOnPage = result.items.map((f) => f.id);
  let votedSet: ReadonlySet<number> = new Set<number>();
  let voteCounts: ReadonlyMap<number, number> = new Map<number, number>();
  try {
    const [uuid, fpInputs] = await Promise.all([
      readVoterUuid(),
      readFingerprintInputs(),
    ]);
    const fingerprint = computeFingerprint(fpInputs);
    [votedSet, voteCounts] = await Promise.all([
      getVotedFindIds(findIdsOnPage, uuid, fingerprint),
      getFindVoteCounts(findIdsOnPage),
    ]);
  } catch {
    // Fingerprint salt unconfigured → load counts only, voted state
    // stays empty. UI still renders, just everyone shows as "not
    // voted yet" until the operator sets VOTE_FINGERPRINT_SALT.
    voteCounts = await getFindVoteCounts(findIdsOnPage);
  }
  // FilterOptions.countries carries raw English (Natural Earth) names —
  // localize at the page boundary so the dropdown reads in the user's
  // language while the cached upstream query stays locale-agnostic.
  const options = {
    ...optionsRaw,
    countries: optionsRaw.countries
      .map((c) => ({
        code: c.code,
        name: localizedCountryName(c.name, locale),
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, locale === "en" ? "en" : "cs"),
      ),
  };

  const hasFilters = !!(
    filters.q ||
    filters.locationId ||
    filters.cadastralArea ||
    filters.country ||
    filters.state ||
    filters.year ||
    filters.dateFrom ||
    filters.dateTo ||
    filters.hasRealPhoto
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
    if (f.hasRealPhoto) params.set("hasPhoto", "1");
    const qs = params.toString();
    return qs ? `/mapa?${qs}` : "/mapa";
  };

  const composeHref = (p: number, s: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.locationId) params.set("loc", String(filters.locationId));
    if (filters.cadastralArea) params.set("city", filters.cadastralArea);
    if (filters.country) params.set("country", filters.country);
    if (filters.state) params.set("state", filters.state);
    if (filters.year) params.set("year", String(filters.year));
    if (filters.dateFrom) params.set("from", dateToString(filters.dateFrom));
    if (filters.dateTo) params.set("to", dateToString(filters.dateTo));
    if (filters.hasRealPhoto) params.set("hasPhoto", "1");
    if (sort !== "desc") params.set("sort", sort);
    if (view !== "list") params.set("view", view);
    if (p > 1) params.set("page", String(p));
    // Only set size when it differs from the default — keeps shared
    // URLs short for the common case.
    if (s !== FINDS_PER_PAGE) params.set("size", String(s));
    const qs = params.toString();
    return qs ? `/sbirka?${qs}` : "/sbirka";
  };
  // Pagination is itself a server component, so it can accept a
  // function prop without tripping the RSC "functions can't cross
  // into client components" rule.
  const buildHref = (p: number) => composeHref(p, pageSize);
  // PageSizeSelector IS "use client" though, so we pre-compute one
  // href per option here on the server side and pass the resulting
  // size→href map down. Each href resets to ?page=1 — the current
  // page index is meaningless under a different size.
  const sizeHrefs = Object.fromEntries(
    SBIRKA_PAGE_SIZES.map((s) => [s, composeHref(1, s)]),
  ) as Record<SbirkaPageSize, string>;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <RememberSbirkaSearch />
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">{t("h1")}</h1>
        <p className="text-gray-600">
          {t("totalSummary", {
            count: result.total,
            withSuffix: result.total === 0 ? "no" : "yes",
          })}
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
            {t("filterActive")}{" "}
            <strong className="font-semibold">
              {t("filterMatches", { count: result.total })}
            </strong>
          </span>
          <Link
            href={buildMapHref(filters)}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-white px-3 py-1.5 text-sm font-medium text-brand-800 shadow-sm transition hover:border-brand-500 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          >
            <MapIcon className="h-4 w-4" aria-hidden />
            <span>{t("showOnMap")}</span>
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
        hasPhoto={filters.hasRealPhoto === true}
      />

      {view === "list" ? (
        <FindList
          finds={result.items}
          votedSet={votedSet}
          voteCounts={voteCounts}
        />
      ) : (
        <FindGrid
          finds={result.items}
          votedSet={votedSet}
          voteCounts={voteCounts}
        />
      )}

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        makeHref={buildHref}
        rightSlot={
          result.total > SBIRKA_PAGE_SIZES[0] ? (
            <PageSizeSelector
              current={pageSize}
              options={SBIRKA_PAGE_SIZES}
              hrefsBySize={sizeHrefs}
            />
          ) : null
        }
      />

      {result.totalPages <= 1 && result.total > SBIRKA_PAGE_SIZES[0] && (
        <div className="flex justify-end">
          <PageSizeSelector
            current={pageSize}
            options={SBIRKA_PAGE_SIZES}
            hrefsBySize={sizeHrefs}
          />
        </div>
      )}
    </div>
  );
}
