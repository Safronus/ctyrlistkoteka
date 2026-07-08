"use client";

import { ExternalLink, Filter, ListIcon, MapPin, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatLocationId, locationDetailHref } from "@/lib/format";
import type { MapLocation } from "@/lib/queries/map";

function toIntlLocale(locale: string): string {
  if (locale === "cs") return "cs-CZ";
  if (locale === "en") return "en-GB";
  return locale;
}

/**
 * "Top sheet" card surfaced when the visitor selects a location.
 * Replaces Leaflet's bound popup at every breakpoint so MapaShell can
 * drop it into different wrappers — full-width banner on mobile, flex
 * sibling next to Vrstvy on desktop.
 */
export function LocationTopSheet({
  location,
  onClose,
  filterSummary = "",
}: {
  location: MapLocation;
  onClose: () => void;
  /** Active /sbirka filter that led here (e.g. "stav Darovaný"), shown as
   *  a context chip so the visitor knows why finds on the map are dimmed.
   *  Empty string → no chip. */
  filterSummary?: string;
}) {
  const t = useTranslations("Mapa");
  const tStats = useTranslations("Statistiky");
  const locale = useLocale();
  const numFmt = new Intl.NumberFormat(toIntlLocale(locale));
  const idLabel = formatLocationId(location.id);
  const showSubtitle =
    location.displayName !== "" && location.displayName !== location.code;
  return (
    <div
      role="dialog"
      aria-label={t("topSheetAria")}
      className="rounded-lg border border-gray-200 bg-white p-3 shadow-xl"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t("close")}
        className="absolute right-1.5 top-1.5 rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>

      <div className="flex items-baseline gap-2 pr-7">
        <span className="font-mono text-[11px] text-gray-500">{idLabel}</span>
        <strong
          className="truncate text-sm leading-tight text-gray-900"
          title={location.code}
        >
          {location.code}
        </strong>
      </div>

      {showSubtitle && (
        <p
          className="mt-0.5 truncate text-xs leading-tight text-gray-600"
          title={location.displayName}
        >
          {location.displayName}
        </p>
      )}

      {(location.parentId !== null || location.isGone) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {location.parentId !== null && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium tracking-wide text-sky-900">
              {t("subPartLabel")}
            </span>
          )}
          {location.isGone && (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-900">
              {t("topSheetGoneBadge")}
            </span>
          )}
        </div>
      )}

      <p className="mt-1.5 text-xs">
        <span className="font-mono text-sm font-semibold text-brand-700">
          {numFmt.format(location.findCount)}
        </span>
        <span className="ml-1 text-gray-600">
          {tStats("labelFinds", { count: location.findCount })}
        </span>
      </p>

      {filterSummary && (
        <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-brand-50 px-2 py-1 text-[11px] leading-snug text-brand-800">
          <Filter className="mt-0.5 h-3 w-3 shrink-0 text-brand-600" aria-hidden />
          <span>{t("filterContext", { summary: filterSummary })}</span>
        </p>
      )}

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Link
          href={locationDetailHref(location.id)}
          className="flex items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          <span>{t("topSheetDetail")}</span>
        </Link>
        <Link
          href={`/sbirka?loc=${location.id}`}
          className="flex items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          <ListIcon className="h-3.5 w-3.5" aria-hidden />
          <span>{t("topSheetShowFinds")}</span>
        </Link>
      </div>

      <p className="mt-1.5 flex items-center gap-1 text-[10px] leading-tight text-gray-400">
        <MapPin className="h-3 w-3" aria-hidden />
        <span>{t("topSheetCloseHint")}</span>
      </p>
    </div>
  );
}
