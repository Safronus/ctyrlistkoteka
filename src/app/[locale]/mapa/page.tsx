import type { Metadata } from "next";
import { FindState } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import { localePath, ogLocale, seoAlternates } from "@/lib/seo";
import { getMapData } from "@/lib/queries/map";
import { listLocations } from "@/lib/queries/locations";
import {
  getFilteredFindIds,
  getHighlightFind,
  type FindFilters,
} from "@/lib/queries/finds";
import { DOMINANT_LOCATION_ID } from "@/lib/constants";
import { buildFilterSummary } from "@/lib/filterSummary";
import { formatShortDateCs, formatTinyDateTimeCs } from "@/lib/format";
import { MapaShell } from "@/components/map/mapa-shell";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations("Mapa");
  const title = t("metaTitle");
  const description = t("metaDescription");
  return {
    title,
    description,
    alternates: seoAlternates("/mapa", locale),
    openGraph: {
      title,
      description,
      locale: ogLocale(locale),
      url: localePath("/mapa", locale),
      images: [{ url: "/og", width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", images: ["/og"] },
  };
}

// `focus` opts the page out of static caching so the focused location is
// honoured on every navigation rather than baked into a single ISR copy.
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pickString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function parseStates(
  value: string | string[] | undefined,
): FindState[] | undefined {
  const raw = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const valid = new Set(Object.values(FindState) as string[]);
  const out = [...new Set(raw.filter((v) => valid.has(v)))] as FindState[];
  return out.length > 0 ? out : undefined;
}

function parseDateOnly(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseDateTime(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default async function MapaPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const focusRaw = pickString(sp.focus);
  // null when the user just navigated to /mapa with no param — that's
  // the signal MapaShell uses to keep the sidebar closed and pick a
  // sensible default focus.
  const urlFocusId =
    focusRaw && /^\d+$/.test(focusRaw) ? Number(focusRaw) : null;
  const findRaw = pickString(sp.find);
  const findId = findRaw && /^\d+$/.test(findRaw) ? Number(findRaw) : null;
  // `?showFinds=1` from /sbirka's "Zobrazit na mapě" chip forces the
  // Nálezy layer on regardless of what the visitor's last session had
  // toggled — the dim/bright highlight + zoom-to-marker cues are
  // invisible if the finds layer is hidden. null when the param isn't
  // present, so MapaShell falls back to its existing default + the
  // localStorage rehydration.
  const showFindsRaw = pickString(sp.showFinds);
  const urlShowFinds = showFindsRaw === "1" ? true : null;

  // /sbirka filter pass-through. When any of these params is present the
  // page resolves the matching find ID set server-side and dims everything
  // outside it on the canvas. Param names mirror /sbirka exactly so a
  // "Zobrazit na mapě" button there can just copy the URL search string.
  const hideDominantOnMap = pickString(sp.hideTop) === "1";
  const findFilters: FindFilters = {
    q: pickString(sp.q) ?? undefined,
    locationId: parsePositiveInt(pickString(sp.loc)),
    cadastralArea: pickString(sp.city) || undefined,
    country: pickString(sp.country) || undefined,
    states: parseStates(sp.state),
    year: parsePositiveInt(pickString(sp.year)),
    dateFrom: parseDateOnly(pickString(sp.from)),
    dateTo: parseDateOnly(pickString(sp.to)),
    foundAtFrom: parseDateTime(pickString(sp.fromTs)),
    foundAtTo: parseDateTime(pickString(sp.toTs)),
    excludeLocationId: hideDominantOnMap ? DOMINANT_LOCATION_ID : undefined,
  };
  const hasFindFilter = !!(
    findFilters.q ||
    findFilters.locationId ||
    findFilters.cadastralArea ||
    findFilters.country ||
    findFilters.states?.length ||
    findFilters.year ||
    findFilters.dateFrom ||
    findFilters.dateTo ||
    findFilters.foundAtFrom ||
    findFilters.foundAtTo ||
    findFilters.excludeLocationId
  );

  // Sidebar lists only locations actually visible on the map — anonymized
  // ones aren't there and showing them with no click target was useless.
  // Former (NEEXISTUJE-) locations stay; their polygons are still on the
  // map.
  const [data, sidebarLocations, highlightFind, highlightIdList] =
    await Promise.all([
      getMapData(),
      listLocations({ showAnonymized: false, showGone: true }),
      findId !== null ? getHighlightFind(findId) : Promise.resolve(null),
      hasFindFilter
        ? getFilteredFindIds(findFilters)
        : Promise.resolve(null),
    ]);

  const highlightFindIds: ReadonlySet<number> | null =
    highlightIdList !== null ? new Set(highlightIdList) : null;

  // Human-readable description of the filter that narrowed this view,
  // surfaced in the location detail sheet so a visitor arriving from a
  // filtered /sbirka "Zobrazit na mapě" chip knows WHY finds are dimmed.
  // Location / city / country are dropped: the sheet already names the
  // location it belongs to, so only the extra dimensions (state, date, …)
  // add information here.
  const tSummary = await getTranslations("FilterSummary");
  const tStates = await getTranslations("States");
  const locale = await getLocale();
  const tSummaryFn = tSummary as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
  const tStateFn = tStates as unknown as (key: string) => string;
  const activeFilterSummary = hasFindFilter
    ? buildFilterSummary(
        {
          ...findFilters,
          locationId: undefined,
          cadastralArea: undefined,
          country: undefined,
        },
        {
          t: tSummaryFn,
          stateLabel: tStateFn,
          locationLabel: () => "",
          countryLabel: () => "",
          cityLabel: (name) => name,
          formatDay: (d) => formatShortDateCs(d, locale),
          formatInstant: (d) => formatTinyDateTimeCs(d, locale),
        },
      )
    : "";

  return (
    // `data-map-fullscreen` triggers the globals.css rules that lock page
    // scroll and hide the footer, so the map owns the whole viewport below
    // the sticky header — without them the page scrolled and the Leaflet
    // panes (high z-index) slid over the header when the wheel was on it.
    // Height offsets match the header: ~6.6rem on the two-row mobile nav,
    // ~3.8rem once it collapses to a single row from `sm` up. 100dvh keeps
    // it right as mobile browser chrome shows/hides.
    <div
      data-map-fullscreen
      className="flex flex-col h-[calc(100dvh-6.6rem)] sm:h-[calc(100dvh-3.8rem)]"
    >
      <div className="flex-1 overflow-hidden">
        <MapaShell
          mapData={data}
          sidebarLocations={sidebarLocations}
          urlFocusId={urlFocusId}
          urlShowFinds={urlShowFinds}
          highlightFind={highlightFind}
          highlightFindIds={highlightFindIds}
          activeFilterSummary={activeFilterSummary}
        />
      </div>
    </div>
  );
}
