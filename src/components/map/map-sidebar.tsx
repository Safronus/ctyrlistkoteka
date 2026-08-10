"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  FilterX,
  HelpCircle,
  Search,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { UNKNOWN_LOCATION_ID } from "@/lib/constants";
import type { LocationListItem } from "@/lib/queries/locations";
import {
  formatAreaM2,
  formatLocationId,
  locationDetailHref,
} from "@/lib/format";
import { paddedIdMatches, parseIdQuery } from "@/lib/search";
import { cityFromCadastralArea } from "@/lib/locationCode";

type MapaT = ReturnType<typeof useTranslations<"Mapa">>;

function toIntlLocale(locale: string): string {
  if (locale === "cs") return "cs-CZ";
  if (locale === "en") return "en-GB";
  return locale;
}

const INPUT_CLS =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 pl-8 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
const SELECT_CLS =
  "w-full cursor-pointer appearance-none rounded-md border border-gray-300 bg-white py-1.5 pl-2 pr-7 text-xs text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400";

/**
 * Scrollable list of locations rendered as a control inside the /mapa
 * sidebar. Anonymized locations are filtered out upstream (they aren't
 * on the map, and listing them with no click target was just noise);
 * former locations get a rose tone and a "Zaniklá" badge.
 */
export function MapSidebar({
  locations,
  focusId,
  onSelect,
  enabledChildPolygonIds,
  onToggleChildPolygon,
  anonymizedLocationCount,
  cities,
  countries,
}: {
  locations: readonly LocationListItem[];
  focusId: number | null;
  onSelect: (id: number) => void;
  enabledChildPolygonIds: ReadonlySet<number>;
  onToggleChildPolygon: (id: number) => void;
  anonymizedLocationCount: number;
  /** City + the country it sits in — the same pairing /lokality cascades
   *  on, from the same `getFilterOptions()`, so the two pages can't
   *  disagree about which town is in which country. */
  cities: ReadonlyArray<{ name: string; country: string }>;
  /** ISO code + localized name, already sorted by the page. */
  countries: ReadonlyArray<{ code: string; name: string }>;
}) {
  const t = useTranslations("Mapa");
  const locale = useLocale();
  const numFmt = new Intl.NumberFormat(toIntlLocale(locale));
  const [q, setQ] = useState("");
  // Local state, not URL params. /lokality filters through the URL because
  // its list is server-rendered; here the whole list is already in the
  // client and a navigation would remount the map — a filter must not
  // throw away the pan/zoom the visitor set up.
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");

  // NEZNÁMÁ (00000) is pulled OUT of the list and given its own chip in the
  // header — it isn't a place you browse past, it's the bucket you jump to.
  // It therefore also drops out of the header's location count.
  const unknownLoc = useMemo(
    () => locations.find((l) => l.id === UNKNOWN_LOCATION_ID) ?? null,
    [locations],
  );
  const realLocations = useMemo(
    () => locations.filter((l) => l.id !== UNKNOWN_LOCATION_ID),
    [locations],
  );

  /** Country each city sits in, from the shared filter options. */
  const countryOfCity = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cities) m.set(c.name, c.country);
    return m;
  }, [cities]);

  /** Every listed location tagged with its city and country, so the two
   *  selects and the list agree on one derivation. `cadastralArea` is the
   *  plain town (v2 manifest `mesto`), same source /lokality reads. */
  const tagged = useMemo(
    () =>
      realLocations.map((l) => {
        const town = cityFromCadastralArea(l.cadastralArea);
        return { loc: l, city: town, country: countryOfCity.get(town) ?? "" };
      }),
    [realLocations, countryOfCity],
  );

  // A chosen city pins its country, exactly as on /lokality — so the
  // country select shows the right value and the city list narrows.
  const effectiveCountry = country || countryOfCity.get(city) || "";

  const countryCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const x of tagged) if (x.country) m[x.country] = (m[x.country] ?? 0) + 1;
    return m;
  }, [tagged]);

  /** Counted WITHIN the chosen country: a town's number should say how many
   *  rows picking it would leave, not how many exist elsewhere too. */
  const cityCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const x of tagged) {
      if (effectiveCountry && x.country !== effectiveCountry) continue;
      if (x.city) m[x.city] = (m[x.city] ?? 0) + 1;
    }
    return m;
  }, [tagged, effectiveCountry]);

  const visibleCities = useMemo(
    () =>
      (effectiveCountry
        ? cities.filter((c) => c.country === effectiveCountry)
        : cities
      ).filter((c) => (cityCounts[c.name] ?? 0) > 0 || c.name === city),
    [cities, effectiveCountry, cityCounts, city],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const idQuery = needle ? parseIdQuery(q) : null;
    return tagged
      .filter((x) => {
        if (city && x.city !== city) return false;
        if (effectiveCountry && x.country !== effectiveCountry) return false;
        if (!needle) return true;
        const l = x.loc;
        if (idQuery !== null) {
          if (l.id === idQuery.exactId) return true;
          if (paddedIdMatches(l.id, idQuery.digits)) return true;
        }
        return (
          l.code.toLowerCase().includes(needle) ||
          l.displayName.toLowerCase().includes(needle) ||
          l.cadastralArea.toLowerCase().includes(needle)
        );
      })
      .map((x) => x.loc);
  }, [tagged, q, city, effectiveCountry]);

  const hasFilters = q.trim() !== "" || city !== "" || country !== "";

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
        <h3 className="min-w-0 text-[11px] font-semibold uppercase tracking-wide text-brand-700">
          {t("sidebarHeading", {
            count: numFmt.format(realLocations.length),
          })}
          {anonymizedLocationCount > 0 && (
            <span
              className="ml-1 normal-case tracking-normal text-gray-400"
              title={t("sidebarAnonymizedTitle")}
            >
              {" "}
              {t("sidebarAnonymizedSuffix", {
                count: numFmt.format(anonymizedLocationCount),
              })}
            </span>
          )}
        </h3>
        {/* NEZNÁMÁ (00000) — right-aligned chip on the same row, grey to match
            its map marker. Focuses the location like a list row would. */}
        {unknownLoc && (
          <button
            type="button"
            onClick={() => onSelect(unknownLoc.id)}
            title={t("sidebarUnknownTitle")}
            className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
              focusId === unknownLoc.id
                ? "border-slate-400 bg-slate-200 text-slate-900"
                : "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <HelpCircle className="h-3 w-3" aria-hidden />
            {t("sidebarUnknownChip", {
              count: numFmt.format(
                unknownLoc.aggregateStats.total || unknownLoc.stats.total,
              ),
            })}
          </button>
        )}
      </div>
      <div className="border-b border-gray-200 p-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className={INPUT_CLS}
          />
        </div>

        {/* Stát → Město, cascading the same way /lokality does: a chosen
            city pins (and locks) its country, changing the country clears
            the city, and the city list narrows to the chosen country. */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="relative">
            <select
              value={effectiveCountry}
              disabled={city !== ""}
              onChange={(e) => {
                setCountry(e.currentTarget.value);
                setCity("");
              }}
              aria-label={t("filterCountry")}
              className={SELECT_CLS}
            >
              <option value="">{t("filterCountryAll")}</option>
              {countries
                .filter(
                  (c) =>
                    (countryCounts[c.code] ?? 0) > 0 ||
                    c.code === effectiveCountry,
                )
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({numFmt.format(countryCounts[c.code] ?? 0)})
                  </option>
                ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
          </div>
          <div className="relative">
            <select
              value={city}
              onChange={(e) => {
                const next = e.currentTarget.value;
                setCity(next);
                // Picking a town pins its country so the label matches the
                // list; clearing it leaves the country as it was.
                if (next) setCountry(countryOfCity.get(next) ?? country);
              }}
              aria-label={t("filterCity")}
              className={SELECT_CLS}
            >
              <option value="">{t("filterCityAll")}</option>
              {visibleCities.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({numFmt.format(cityCounts[c.name] ?? 0)})
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
          </div>
        </div>

        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setCity("");
              setCountry("");
            }}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-gray-500 underline-offset-2 transition hover:text-gray-800 hover:underline"
          >
            <FilterX className="h-3 w-3" aria-hidden />
            {t("filterClear", { count: numFmt.format(filtered.length) })}
          </button>
        )}
      </div>
      <ul className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <li className="p-4 text-center text-sm text-gray-500">
            {t("noLocations")}
          </li>
        ) : (
          filtered.map((l) => (
            <li
              key={l.id}
              className="border-b border-gray-100 last:border-b-0"
            >
              <SidebarRow
                location={l}
                focused={focusId === l.id}
                onSelect={onSelect}
                polygonEnabled={enabledChildPolygonIds.has(l.id)}
                onTogglePolygon={onToggleChildPolygon}
                t={t}
                numFmt={numFmt}
              />
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function SidebarRow({
  location,
  focused,
  onSelect,
  polygonEnabled,
  onTogglePolygon,
  t,
  numFmt,
}: {
  location: LocationListItem;
  focused: boolean;
  onSelect: (id: number) => void;
  polygonEnabled: boolean;
  onTogglePolygon: (id: number) => void;
  t: MapaT;
  numFmt: Intl.NumberFormat;
}) {
  const isChild = location.parentId !== null;
  const hasParts = location.childCount > 0;
  // A child draws something on the map that the eye can toggle: a
  // polygon (LocationPolygons) when it has one, otherwise a centre-point
  // dot (LocationDots). Polygon-less children used to render their dot
  // unconditionally with no way to hide it — now both kinds get the eye.
  const hasPolygon = location.polygonAreaM2 !== null;
  const showPolygonToggle =
    isChild && (hasPolygon || location.coordinates !== null);
  const toggleHideLabel = hasPolygon ? t("polygonHide") : t("markerHide");
  const toggleShowLabel = hasPolygon ? t("polygonShow") : t("markerShow");

  const tone = location.isGone ? "bg-rose-50/60" : "";
  const focusedTone = focused ? "ring-2 ring-inset ring-brand-500" : "";
  const indent = isChild
    ? "border-l-4 border-brand-200 bg-brand-50/40 pl-5"
    : "pl-3";

  const findsTotal = hasParts
    ? location.aggregateStats.total
    : location.stats.total;

  return (
    <div
      className={`flex w-full items-stretch overflow-hidden ${tone} ${focusedTone}`}
    >
      <button
        type="button"
        onClick={() => onSelect(location.id)}
        className={`flex min-w-0 flex-1 items-start gap-2 py-2 text-left transition hover:bg-brand-50 focus:bg-brand-50 focus:outline-none ${indent} ${showPolygonToggle ? "pr-1" : "pr-3"}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-xs text-gray-500">
              {formatLocationId(location.id)}
            </span>
            <span
              className="truncate text-sm font-semibold text-gray-900"
              title={location.code}
            >
              {location.code}
            </span>
            {location.isGone && (
              <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-800">
                {t("rowGoneBadge")}
              </span>
            )}
            {hasParts && (
              <span
                className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-800"
                title={t("rowPartsTitle", { count: location.childCount })}
              >
                {t("rowPartsBadge", { count: location.childCount })}
              </span>
            )}
          </div>
          {location.displayName && location.displayName !== location.code && (
            <p
              className="truncate text-xs text-gray-500"
              title={location.displayName}
            >
              {location.displayName}
            </p>
          )}
          <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-gray-500">
            <span className="font-medium text-brand-700">
              {numFmt.format(findsTotal)}{" "}
              {/* Reuse Statistiky.labelFinds via a fallback — keep it
                  inline through the existing translator namespace by
                  delegating to FindRow's countSuffix which already has
                  the ICU plural we need. */}
              <FindsLabel count={findsTotal} />
            </span>
            {location.polygonAreaM2 !== null && (
              <span>· {formatAreaM2(location.polygonAreaM2)}</span>
            )}
          </p>
        </div>
      </button>
      {showPolygonToggle && (
        <button
          type="button"
          onClick={() => onTogglePolygon(location.id)}
          aria-pressed={polygonEnabled}
          aria-label={polygonEnabled ? toggleHideLabel : toggleShowLabel}
          title={polygonEnabled ? toggleHideLabel : toggleShowLabel}
          className={`flex shrink-0 items-center justify-center px-2 transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 ${
            polygonEnabled
              ? "text-brand-700 hover:bg-brand-100"
              : "text-gray-400 hover:bg-brand-50 hover:text-brand-700"
          }`}
        >
          {polygonEnabled ? (
            <Eye className="h-4 w-4" aria-hidden />
          ) : (
            <EyeOff className="h-4 w-4" aria-hidden />
          )}
        </button>
      )}
      <Link
        href={locationDetailHref(location.id)}
        aria-label={t("rowDetailAria")}
        title={t("rowDetailAria")}
        className="flex shrink-0 items-center justify-center px-2 text-gray-400 transition hover:bg-brand-50 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500"
      >
        <ExternalLink className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}

function FindsLabel({ count }: { count: number }) {
  const tStats = useTranslations("Statistiky");
  // Strip the leading "{count} " — Statistiky.labelFinds is just the
  // plural noun without the number; render it bare here.
  return <>{tStats("labelFinds", { count })}</>;
}
