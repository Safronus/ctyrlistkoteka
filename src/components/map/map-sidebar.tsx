"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Eye, EyeOff, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { LocationListItem } from "@/lib/queries/locations";
import {
  formatAreaM2,
  formatLocationId,
  locationDetailHref,
} from "@/lib/format";
import { paddedIdMatches, parseIdQuery } from "@/lib/search";

type MapaT = ReturnType<typeof useTranslations<"Mapa">>;

function toIntlLocale(locale: string): string {
  if (locale === "cs") return "cs-CZ";
  if (locale === "en") return "en-GB";
  return locale;
}

const INPUT_CLS =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 pl-8 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

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
}: {
  locations: readonly LocationListItem[];
  focusId: number | null;
  onSelect: (id: number) => void;
  enabledChildPolygonIds: ReadonlySet<number>;
  onToggleChildPolygon: (id: number) => void;
  anonymizedLocationCount: number;
}) {
  const t = useTranslations("Mapa");
  const locale = useLocale();
  const numFmt = new Intl.NumberFormat(toIntlLocale(locale));
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return locations;
    const idQuery = parseIdQuery(q);
    return locations.filter((l) => {
      if (idQuery !== null) {
        if (l.id === idQuery.exactId) return true;
        if (paddedIdMatches(l.id, idQuery.digits)) return true;
      }
      return (
        l.code.toLowerCase().includes(needle) ||
        l.displayName.toLowerCase().includes(needle) ||
        l.cadastralArea.toLowerCase().includes(needle)
      );
    });
  }, [locations, q]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-gray-200 px-3 py-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {t("sidebarHeading", { count: numFmt.format(locations.length) })}
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
  const showPolygonToggle = isChild && location.polygonAreaM2 !== null;

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
          aria-label={polygonEnabled ? t("polygonHide") : t("polygonShow")}
          title={polygonEnabled ? t("polygonHide") : t("polygonShow")}
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
