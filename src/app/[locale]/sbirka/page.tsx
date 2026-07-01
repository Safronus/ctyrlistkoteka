import type { Metadata } from "next";
import { headers } from "next/headers";
import { Map as MapIcon } from "lucide-react";
import { FindState } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import { localizedCountryName } from "@/lib/world-countries";
import { localePath, ogLocale, seoAlternates } from "@/lib/seo";
import { Link } from "@/i18n/navigation";
import { CollectionProgressBanner } from "@/components/finds/collection-progress-banner";
import { FilterBar } from "@/components/finds/filter-bar";
import { HelpDialog } from "@/components/help/help-dialog";
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
import { getFindIdsWithRealPhotos } from "@/lib/findPhotos";
import { cityFromCadastralArea } from "@/lib/locationCode";
import {
  countFindsAtLocationSubtree,
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

/** Parses a full ISO instant (e.g. "2026-06-19T07:12:34.000Z") for the
 *  precise found_at window the /statistiky "zátah" deep-link uses.
 *  Returns undefined for anything that isn't a valid date-time. */
function parseDateTime(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
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

/** Phone-class User-Agent → the default view is the tile grid; tablets
 *  and desktops default to the list. `Mobi` covers iPhone + Android
 *  phones (Chrome on Android tablets omits it, so they stay on the list,
 *  matching desktop). Only a *default*: an explicit `?view=` always wins. */
const MOBILE_UA_RE =
  /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|IEMobile|Opera Mini/i;

/** Explicit `?view=` choice, or null when absent (→ fall back to the
 *  UA-derived default). */
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
  const tHelp = await getTranslations("SbirkaHelp");

  // The "Skrýt největší lokalitu" toggle posts `?hideTop=1` rather
  // than `?exLoc=<id>` so the user-visible URL stays stable across
  // any future change to `DOMINANT_LOCATION_ID`. The constant gates
  // the id we actually exclude; the URL just carries the boolean
  // intent.
  const hideDominant = pickString(sp.hideTop) === "1";
  const filters: FindFilters = {
    q: pickString(sp.q) ?? undefined,
    locationId: parseInt(pickString(sp.loc)),
    // Normalize the URL value to the canonical city (strip
    // NEEXISTUJE-). The query layer expands it back to match both
    // spellings, but keeping the filter object in canonical form
    // ensures the dropdown's selected value lines up with what the
    // user sees in the list.
    cadastralArea: cityFromCadastralArea(pickString(sp.city)) || undefined,
    country: pickString(sp.country) || undefined,
    state: parseState(pickString(sp.state)),
    year: parseInt(pickString(sp.year)),
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
  const page = parseInt(pickString(sp.page)) ?? 1;
  const pageSize = parseSbirkaPageSize(pickString(sp.size));
  const sort = parseSort(pickString(sp.sort));
  // View defaults responsively: phones get the tile grid, everyone else
  // the list. The page is force-dynamic, so reading the request UA here
  // is free and renders a single view (no flash, no double-render). An
  // explicit `?view=` from the toolbar always overrides the default.
  const explicitView = parseExplicitView(pickString(sp.view));
  const ua = (await headers()).get("user-agent") ?? "";
  const defaultView: FindView = MOBILE_UA_RE.test(ua) ? "grid" : "list";
  const view: FindView = explicitView ?? defaultView;

  const locale = await getLocale();
  // Resolve the dominant location's code for the toggle's hover label
  // ("Skrýt #00003 — ZLÍN_JSVAHY-KŘIBY-V001"). Single trip, cached
  // per-request because the dynamic page already short-circuits the
  // RSC cache; the cost is negligible next to listFinds. Null when
  // the configured id doesn't exist yet (early dev, fresh DB) — the
  // toggle hides itself in that case.
  const [
    optionsRaw,
    result,
    progress,
    dominantLocation,
    donationPhotoIds,
    dominantFindCount,
  ] = await Promise.all([
    getFilterOptions(),
    listFinds(filters, page, pageSize, sort),
    getCollectionProgress(),
    prisma.location.findUnique({
      where: { id: DOMINANT_LOCATION_ID },
      select: { id: true, code: true },
    }),
    // Counts shown on the two ViewSortToolbar toggles, both
    // independent of the active filter so they read as "how big is
    // the pool this toggle touches". Donation-photo set comes from
    // the on-disk find-photos directory cache; dominant-location
    // count mirrors the hideTop exclude subtree.
    getFindIdsWithRealPhotos(),
    countFindsAtLocationSubtree(DOMINANT_LOCATION_ID),
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
    filters.foundAtFrom ||
    filters.foundAtTo ||
    filters.hasRealPhoto ||
    filters.excludeLocationId
  );

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
  const mapLinkApplies = singleFindId !== null || !!filters.locationId;
  const buildMapHref = (f: typeof filters) => {
    if (singleFindId !== null) {
      return `/mapa?find=${singleFindId}&showFinds=1`;
    }
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
    if (f.excludeLocationId) params.set("hideTop", "1");
    // Auto-zoom to the location whenever it's part of the filter. The
    // map already accepts `focus` from /lokality deep-links so we can
    // piggy-back on that path here.
    if (f.locationId) params.set("focus", String(f.locationId));
    params.set("showFinds", "1");
    return `/mapa?${params.toString()}`;
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
      <RememberSbirkaSearch />
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold text-gray-900">{t("h1")}</h1>
          {/* Help dialog button. MAINTENANCE: when you change the
              filters, sort options, layers, or any other public-page
              feature listed in the dialog, update the matching
              SbirkaHelp.* keys in cs.json / en.json. The help text
              is part of the page's UX contract. */}
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
                  tHelp("sectionFilters4"),
                ],
              },
              {
                heading: tHelp("sectionViewsTitle"),
                items: [
                  tHelp("sectionViews1"),
                  tHelp("sectionViews2"),
                  tHelp("sectionViews3"),
                ],
              },
              {
                heading: tHelp("sectionMapTitle"),
                items: [tHelp("sectionMap1"), tHelp("sectionMap2")],
              },
              {
                heading: tHelp("sectionVoteTitle"),
                items: [tHelp("sectionVote1"), tHelp("sectionVote2")],
              },
              {
                heading: tHelp("sectionDetailTitle"),
                items: [tHelp("sectionDetail1")],
              },
            ]}
          />
        </div>
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
          {/* Map link only renders for the two filter shapes that
              translate to a meaningful map view — see mapLinkApplies
              above. City / country / state-only / etc. multi-region
              filters hide the chip; for them /mapa would just show
              the world with diffuse highlight dim, which the user
              flagged as worse than no chip at all. */}
          {mapLinkApplies && (
            <Link
              href={buildMapHref(filters)}
              className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-white px-3 py-1.5 text-sm font-medium text-brand-800 shadow-sm transition hover:border-brand-500 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              <MapIcon className="h-4 w-4" aria-hidden />
              <span>{t("showOnMap")}</span>
            </Link>
          )}
        </div>
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
        hasPhotoCount={donationPhotoIds.size}
        hideDominant={hideDominant}
        hideDominantCount={dominantFindCount}
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
