import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Map as MapIcon } from "lucide-react";
import { FindState } from "@/generated/prisma/enums";
import { getLocale, getTranslations } from "next-intl/server";
import { localizedCountryName } from "@/lib/world-countries";
import { localePath, ogLocale, seoAlternates } from "@/lib/seo";
import { Link } from "@/i18n/navigation";
import { CollectionProgressBanner } from "@/components/finds/collection-progress-banner";
import { FilterablePageHeader } from "@/components/filterable-page-header";
import { FilterActiveNotice } from "@/components/filter-active-notice";
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
import { DOMINANT_LOCATION_ID, FINDS_PER_PAGE } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { cityFromCadastralArea } from "@/lib/locationCode";
import {
  formatShortDateCs,
  formatTinyDateTimeCs,
  formatLocationId,
} from "@/lib/format";
import { buildFilterSummary } from "@/lib/filterSummary";
import {
  getCollectionProgress,
  getFacetCounts,
  getFilteredLocationSpan,
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
  const locale = await getLocale();
  const t = await getTranslations("Sbirka");
  const title = t("metaTitle");
  const description = t("metaDescription");
  return {
    title,
    description,
    alternates: seoAlternates("/sbirka", locale),
    openGraph: {
      title,
      description,
      locale: ogLocale(locale),
      url: localePath("/sbirka", locale),
      images: [{ url: "/og", width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", images: ["/og"] },
  };
}

// SSR — filters come from URL, so revalidation isn't useful. Each request
// runs the Prisma query. Fine for desktop-sized concurrency on this site.
export const dynamic = "force-dynamic";

function parsePositiveInt(value: string | undefined): number | undefined {
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

/** Parses a full ISO instant (e.g. "2026-06-19T07:12:34.000Z") for the
 *  precise found_at window the /statistiky "zátah" deep-link uses.
 *  Returns undefined for anything that isn't a valid date-time. */
function parseDateTime(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Parse the (possibly repeated) `?state=` param into a de-duplicated list
 *  of valid states. `state=LOST&state=ANONYMIZED` → `[LOST, ANONYMIZED]`. */
function parseStates(
  value: string | string[] | undefined,
): FindState[] | undefined {
  const raw = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const valid = new Set(Object.values(FindState) as string[]);
  const out = [...new Set(raw.filter((v) => valid.has(v)))] as FindState[];
  return out.length > 0 ? out : undefined;
}

function parseSort(value: string | undefined): FindSort {
  if (value === "votes-desc") return "votes-desc";
  if (value === "asc") return "asc";
  if (value === "dist-asc") return "dist-asc";
  if (value === "dist-desc") return "dist-desc";
  return "desc";
}

/** Explicit `?view=` choice, or the remembered `view` cookie value, parsed
 *  to a FindView — null when absent/garbage (→ fall back to the default). */
function parseExplicitView(value: string | undefined): FindView | null {
  return value === "grid" ? "grid" : value === "list" ? "list" : null;
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

  // The "Skrýt největší lokalitu" toggle posts `?hideTop=1` rather
  // than `?exLoc=<id>` so the user-visible URL stays stable across
  // any future change to `DOMINANT_LOCATION_ID`. The constant gates
  // the id we actually exclude; the URL just carries the boolean
  // intent.
  const hideDominant = pickString(sp.hideTop) === "1";
  const filters: FindFilters = {
    q: pickString(sp.q) ?? undefined,
    // Dedicated exact find-number box (`?id=140`) — matches #140 only.
    exactId: parsePositiveInt(pickString(sp.id)),
    locationId: parsePositiveInt(pickString(sp.loc)),
    // cityFromCadastralArea just coerces to string (v2 cadastralAreas are the
    // plain city); `|| undefined` drops an empty filter.
    cadastralArea: cityFromCadastralArea(pickString(sp.city)) || undefined,
    country: pickString(sp.country) || undefined,
    states: parseStates(sp.state),
    noState: pickString(sp.nostate) === "1" ? true : undefined,
    year: parsePositiveInt(pickString(sp.year)),
    dateFrom: parseDateOnly(pickString(sp.from)),
    dateTo: parseDateOnly(pickString(sp.to)),
    // Precise instant window from the /statistiky "zátah" deep-link —
    // isolates exactly that one collecting bout (vs. the day-level
    // from/to above which would also pull in the rest of the day).
    foundAtFrom: parseDateTime(pickString(sp.fromTs)),
    foundAtTo: parseDateTime(pickString(sp.toTs)),
    hasRealPhoto: pickString(sp.hasPhoto) === "1" ? true : undefined,
    excludeLocationId: hideDominant ? DOMINANT_LOCATION_ID : undefined,
  };
  const page = parsePositiveInt(pickString(sp.page)) ?? 1;
  const pageSize = parseSbirkaPageSize(pickString(sp.size));
  const sort = parseSort(pickString(sp.sort));
  // View: an explicit `?view=` wins; otherwise the visitor's remembered
  // choice (the functional `view` cookie the toolbar sets); otherwise the
  // tile grid by default. Read server-side (the page is force-dynamic) so a
  // single view renders — no flash, no double-render.
  const explicitView = parseExplicitView(pickString(sp.view));
  const cookieView = parseExplicitView((await cookies()).get("view")?.value);
  const defaultView: FindView = "grid";
  const view: FindView = explicitView ?? cookieView ?? defaultView;

  // Easter egg: the "Hledat podle čísla" placeholder cycles the owner's two
  // special finds by day-of-month parity — 111 (heavenly) on odd days, 666
  // (hellish) on even. Prague-local day; this page is force-dynamic, so it
  // updates per request without a hydration mismatch (server-computed prop).
  const pragueDay = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Prague",
      day: "numeric",
    }).format(new Date()),
  );
  const idPlaceholderExample = pragueDay % 2 === 1 ? 111 : 666;

  const locale = await getLocale();
  // `?debug=timing` renders a hidden per-phase timing block (curl-readable /
  // view-source-able) for profiling this force-dynamic page. Zero overhead
  // on normal loads — the timers are cheap Date.now() calls and the sink is
  // only passed when the flag is on.
  const debugTiming = pickString(sp.debug) === "timing";
  const bt: Record<string, number> = {};
  const ptap = <T,>(key: string, p: Promise<T>): Promise<T> => {
    if (!debugTiming) return p;
    const t = Date.now();
    return p.then((r) => {
      bt[key] = Date.now() - t;
      return r;
    });
  };
  const tBatchStart = Date.now();
  // Resolve the dominant location's code for the toggle's hover label
  // ("Skrýt #00003 — ZLÍN_JSVAHY-KŘIBY-V001"). Single trip, cached
  // per-request because the dynamic page already short-circuits the
  // RSC cache; the cost is negligible next to listFinds. Null when
  // the configured id doesn't exist yet (early dev, fresh DB) — the
  // toggle hides itself in that case.
  const [optionsRaw, result, progress, dominantLocation] = await Promise.all([
    ptap("batch.filterOptions", getFilterOptions()),
    ptap("batch.listFinds", listFinds(filters, page, pageSize, sort)),
    ptap("batch.progress", getCollectionProgress()),
    ptap(
      "batch.dominant",
      prisma.location.findUnique({
        where: { id: DOMINANT_LOCATION_ID },
        select: { id: true, code: true },
      }),
    ),
  ]);
  const msBatch = Date.now() - tBatchStart;
  // Faceted counts for the filter dropdowns + the two toolbar toggles:
  // every dimension's numbers react to the OTHER active filters, and
  // zero-count options drop out of the lists. Runs after getFilterOptions
  // because it reuses that call's resolved location → city/country map.
  const facetTimings: Record<string, number> = {};
  const tFacetsStart = Date.now();
  const facets = await getFacetCounts(
    filters,
    optionsRaw.locations,
    debugTiming ? facetTimings : undefined,
  );
  const msFacets = Date.now() - tFacetsStart;

  // Pre-resolve "did this visitor already vote?" + counts for the
  // page of finds. Done at the SSR boundary so the rendered buttons
  // start in the correct state (no client flash). Cookie + fingerprint
  // are both checked — see src/lib/votes.ts for the OR-match rule.
  // Wrap the lookup in try/catch: a missing VOTE_FINGERPRINT_SALT
  // shouldn't crash /sbirka, just disables the per-row state.
  const findIdsOnPage = result.items.map((f) => f.id);
  let votedSet: ReadonlySet<number> = new Set<number>();
  let voteCounts: ReadonlyMap<number, number> = new Map<number, number>();
  const tVotesStart = Date.now();
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
  const msVotes = Date.now() - tVotesStart;
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
    filters.exactId ||
    filters.locationId ||
    filters.cadastralArea ||
    filters.country ||
    filters.states?.length ||
    filters.noState ||
    filters.year ||
    filters.dateFrom ||
    filters.dateTo ||
    filters.foundAtFrom ||
    filters.foundAtTo ||
    filters.hasRealPhoto ||
    filters.excludeLocationId
  );

  // The completeness notice ("Sbírka se postupně doplňuje") is a collapsed
  // disclosure next to the total count. `progress` is filter-INDEPENDENT
  // (getCollectionProgress() sees the whole collection), so the leading-gap
  // / internal-hole facts it describes are the same however the visitor
  // arrived — show the toggle whenever there's a real gap, even on a
  // filtered view (deep-link from a location's "Ukázat nálezy" or the
  // homepage "Nejlepší den"). It used to be hidden under any filter, which
  // made the icon flicker away on those deep-links for no real reason.
  const progressLeadingGap =
    progress.minFindId !== null ? Math.max(0, progress.minFindId - 1) : 0;
  const progressInternalGaps =
    progress.minFindId !== null && progress.maxFindId !== null
      ? progress.maxFindId - progress.minFindId + 1 - progress.count
      : 0;
  const showProgressNotice =
    progress.count > 0 &&
    (progressLeadingGap > 0 || progressInternalGaps > 0);

  // Localized one-line description of the active filters, appended to the
  // "Filtr je aktivní" banner so the visitor sees WHAT is narrowing the
  // view — most valuable when they arrive from a deep-link that set a
  // non-obvious filter (e.g. the homepage "Nejlepší den" date link). Same
  // FilterSummary namespace /mapa reuses, so both pages phrase it alike.
  const tSummary = await getTranslations("FilterSummary");
  const tStates = await getTranslations("States");
  // next-intl's translators are keyed to their namespace's literal keys;
  // buildFilterSummary passes keys as plain strings, so widen once here.
  const tSummaryFn = tSummary as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
  const tStateFn = tStates as unknown as (key: string) => string;
  const filterSummary = hasFilters
    ? buildFilterSummary(filters, {
        t: tSummaryFn,
        stateLabel: tStateFn,
        locationLabel: (id) =>
          options.locations.find((l) => l.id === id)?.label ??
          formatLocationId(id),
        countryLabel: (code) =>
          options.countries.find((c) => c.code === code)?.name ?? code,
        cityLabel: (name) => name,
        formatDay: (d) => formatShortDateCs(d, locale),
        formatInstant: (d) => formatTinyDateTimeCs(d, locale),
      })
    : "";

  // Result-aware /mapa deep-link for the "Zobrazit na mapě" toolbar
  // chip. /mapa accepts the same filter param shape (q, loc, city,
  // country, state, year, from, to) and dims everything outside the
  // resolved find-id set, but only two narrow filter shapes translate
  // to a meaningful map experience — see `mapLinkApplies` below for
  // the gate. The other combos hide the chip entirely.
  //
  // Two supported shapes:
  //
  //   1. `result.total === 1` → use /mapa?find=<id>. Same URL the
  //      per-row MapPin chip emits → /mapa highlights + zooms-to-find
  //      via its existing `findId` deep-link path. Cleanest match for
  //      "I filtered by exact ID and want THAT one on the map."
  //
  //   2. `filters.locationId` set (with or without additional filters
  //      narrowing the set further) → append ?focus=<id>. The map
  //      treats focus like the deep-link from /lokality and fitBounds
  //      to that location's polygon, so the visitor lands on a useful
  //      zoom level instead of the world view. Highlight dimming
  //      still kicks in for any extra filters (state, year, ...) so
  //      the matching subset stays distinguishable from the rest of
  //      that location's finds.
  //
  // Both shapes also append `showFinds=1` to force the "Nálezy" layer
  // on regardless of what the visitor's last /mapa session set — the
  // dim/bright + zoom-to-marker cues are invisible if the dots layer
  // is hidden, and arriving from this chip with no dots was the
  // single biggest reason users called the chip broken.
  const singleFindId =
    result.total === 1 ? (result.items[0]?.id ?? null) : null;
  // The chip must only lead to a useful single-location map view. Work out
  // how many mappable (non-anonymized) locations the filtered finds span:
  //  - explicit location filter → focus it, provided its subtree holds at
  //    least one mappable find (an anonymized-only location has none, so
  //    the chip correctly hides);
  //  - otherwise → only when the whole result collapses to exactly one
  //    location (a state / date filter that happens to hit a single spot).
  // Anything spanning many locations, or anonymized-only, hides the chip —
  // clicking through would just show the world with a diffuse dim, which
  // the user flagged as worse than no chip.
  let focusLocationId: number | null = null;
  if (hasFilters && singleFindId === null) {
    const span = await getFilteredLocationSpan(filters);
    focusLocationId =
      filters.locationId != null
        ? span.mappableLocationCount >= 1
          ? filters.locationId
          : null
        : span.soleLocationId;
  }
  const mapLinkApplies = singleFindId !== null || focusLocationId !== null;
  const buildMapHref = (f: typeof filters) => {
    if (singleFindId !== null) {
      return `/mapa?find=${singleFindId}&showFinds=1`;
    }
    const params = new URLSearchParams();
    if (f.q) params.set("q", f.q);
    if (f.locationId) params.set("loc", String(f.locationId));
    if (f.cadastralArea) params.set("city", f.cadastralArea);
    if (f.country) params.set("country", f.country);
    if (f.states) for (const s of f.states) params.append("state", s);
    if (f.noState) params.set("nostate", "1");
    if (f.year) params.set("year", String(f.year));
    if (f.dateFrom) params.set("from", dateToString(f.dateFrom));
    if (f.dateTo) params.set("to", dateToString(f.dateTo));
    if (f.hasRealPhoto) params.set("hasPhoto", "1");
    if (f.excludeLocationId) params.set("hideTop", "1");
    // Auto-zoom to the sole matching location — the explicit location
    // filter, or the single location the result collapsed to. The map
    // already accepts `focus` from /lokality deep-links so we piggy-back
    // on that path here.
    if (focusLocationId != null) params.set("focus", String(focusLocationId));
    params.set("showFinds", "1");
    return `/mapa?${params.toString()}`;
  };

  const composeHref = (p: number, s: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.exactId) params.set("id", String(filters.exactId));
    if (filters.locationId) params.set("loc", String(filters.locationId));
    if (filters.cadastralArea) params.set("city", filters.cadastralArea);
    if (filters.country) params.set("country", filters.country);
    if (filters.states) for (const s of filters.states) params.append("state", s);
    if (filters.noState) params.set("nostate", "1");
    if (filters.year) params.set("year", String(filters.year));
    if (filters.dateFrom) params.set("from", dateToString(filters.dateFrom));
    if (filters.dateTo) params.set("to", dateToString(filters.dateTo));
    // Carry the precise "zátah" window through pagination / sort / size
    // so paging within a single bout doesn't fall back to the whole day.
    if (filters.foundAtFrom)
      params.set("fromTs", filters.foundAtFrom.toISOString());
    if (filters.foundAtTo) params.set("toTs", filters.foundAtTo.toISOString());
    if (filters.hasRealPhoto) params.set("hasPhoto", "1");
    if (filters.excludeLocationId) params.set("hideTop", "1");
    if (sort !== "desc") params.set("sort", sort);
    // Only carry `view` when it differs from this device's default —
    // keeps shared/paginated URLs clean for the common (un-toggled) case.
    if (view !== defaultView) params.set("view", view);
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
      {debugTiming && (
        <div
          hidden
          data-sbirka-timing={`batch=${msBatch} facets=${msFacets} votes=${msVotes} approxTotal=${
            msBatch + msFacets + msVotes
          } rows=${result.items.length} :: ${Object.entries(bt)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ")} :: ${Object.entries(facetTimings)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ")}`}
        />
      )}
      <RememberSbirkaSearch />
      <FilterablePageHeader
        // Filter-independent totals, pinned to the right of the title. The
        // per-filter count moved to the "Filtr je aktivní" strip below.
        counts={t("headingCounts", {
          locations: options.locations.length,
          finds: progress.count,
        })}
        progressToggleLabel={
          showProgressNotice ? t("progressToggle") : undefined
        }
        notice={
          <CollectionProgressBanner
            count={progress.count}
            minFindId={progress.minFindId}
            maxFindId={progress.maxFindId}
            gaps={progress.gaps}
          />
        }
      >
        <h1 className="text-3xl font-bold text-gray-900">{t("h1")}</h1>
      </FilterablePageHeader>

      <FilterBar
        options={options}
        facets={facets}
        idPlaceholderExample={idPlaceholderExample}
        current={{
          q: filters.q ?? "",
          idQuery: filters.exactId ? String(filters.exactId) : "",
          locationId: filters.locationId ? String(filters.locationId) : "",
          city: filters.cadastralArea ?? "",
          country: filters.country ?? "",
          states: filters.states ?? [],
          noState: !!filters.noState,
          year: filters.year ? String(filters.year) : "",
          hasDate: !!(
            filters.dateFrom ||
            filters.dateTo ||
            filters.foundAtFrom ||
            filters.foundAtTo
          ),
        }}
      />

      {hasFilters && (
        <FilterActiveNotice
          label={t("filterActive")}
          matches={t("filterMatches", { count: result.total })}
          summary={filterSummary}
          // Map link only renders for the two filter shapes that translate
          // to a meaningful map view — see mapLinkApplies above. City /
          // country / state-only / etc. multi-region filters hide the chip;
          // for them /mapa would just show the world with a diffuse dim.
          action={
            mapLinkApplies ? (
              <Link
                href={buildMapHref(filters)}
                className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-white px-3 py-1.5 text-sm font-medium text-brand-800 shadow-sm transition hover:border-brand-500 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              >
                <MapIcon className="h-4 w-4" aria-hidden />
                <span>{t("showOnMap")}</span>
              </Link>
            ) : undefined
          }
        />
      )}

      <ViewSortToolbar
        view={view}
        defaultView={defaultView}
        sort={sort}
        dateFrom={dateToString(filters.dateFrom)}
        dateTo={dateToString(filters.dateTo)}
        minDate={options.minDate}
        maxDate={options.maxDate}
        hasPhoto={filters.hasRealPhoto === true}
        hasPhotoCount={facets.hasPhoto}
        hideDominant={hideDominant}
        hideDominantCount={facets.hideDominant}
        // Pass the dominant location's code through so the toggle's
        // title attribute shows the user *which* location is being
        // hidden — better than a context-free "Skrýt největší
        // lokalitu" if a year from now they forgot which one that
        // is. Hides the toggle entirely when the configured id
        // doesn't resolve (fresh DB / wrong constant).
        dominantLocationCode={dominantLocation?.code ?? null}
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
