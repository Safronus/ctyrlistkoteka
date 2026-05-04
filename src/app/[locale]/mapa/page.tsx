import type { Metadata } from "next";
import { FindState } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { getMapData } from "@/lib/queries/map";
import { listLocations } from "@/lib/queries/locations";
import {
  getFilteredFindIds,
  getHighlightFind,
  type FindFilters,
} from "@/lib/queries/finds";
import { MapaShell } from "@/components/map/mapa-shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Mapa");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
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

function parseDateOnly(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00.000Z`);
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

  // /sbirka filter pass-through. When any of these params is present the
  // page resolves the matching find ID set server-side and dims everything
  // outside it on the canvas. Param names mirror /sbirka exactly so a
  // "Zobrazit na mapě" button there can just copy the URL search string.
  const findFilters: FindFilters = {
    q: pickString(sp.q) ?? undefined,
    locationId: parseInt(pickString(sp.loc)),
    cadastralArea: pickString(sp.city) || undefined,
    country: pickString(sp.country) || undefined,
    state: parseState(pickString(sp.state)),
    year: parseInt(pickString(sp.year)),
    dateFrom: parseDateOnly(pickString(sp.from)),
    dateTo: parseDateOnly(pickString(sp.to)),
  };
  const hasFindFilter = !!(
    findFilters.q ||
    findFilters.locationId ||
    findFilters.cadastralArea ||
    findFilters.country ||
    findFilters.state ||
    findFilters.year ||
    findFilters.dateFrom ||
    findFilters.dateTo
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

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 125px)" }}>
      <div className="flex-1 overflow-hidden">
        <MapaShell
          mapData={data}
          sidebarLocations={sidebarLocations}
          urlFocusId={urlFocusId}
          highlightFind={highlightFind}
          highlightFindIds={highlightFindIds}
        />
      </div>
    </div>
  );
}
