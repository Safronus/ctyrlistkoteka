"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { formatGps, GPS_FORMATS, type GpsFormat } from "@/lib/gpsFormat";

/**
 * Renders a (lat, lng) pair, with a button that cycles through several
 * presentations (see `GPS_FORMATS` / `formatGps`): Apple DMS, verbose DMS,
 * degrees-decimal-minutes, signed decimal degrees and UTM. Direction
 * letters follow the locale (Czech S/J/V/Z instead of N/S/E/W).
 */
export function GpsValue({
  lat,
  lng,
  tone = "default",
}: {
  lat: number;
  lng: number;
  /** "default" — green "GPS" label (matching every other uppercase
   *  section eyebrow site-wide) with a neutral gray coordinate value;
   *  used in /lokality and the regular find-detail header. "dark" —
   *  red-tinted, used by the hellish #666 detail where the surrounding
   *  background is dark. "brand" — fully brand-green (value included),
   *  matching the location-map deep-link chips; used by the find-detail
   *  photo's GPS overlay. */
  tone?: "default" | "dark" | "brand";
}) {
  const t = useTranslations("GpsValue");
  const locale = useLocale();
  const [format, setFormat] = useState<GpsFormat>("apple");

  // Defensive stopPropagation — when the GPS row sits inside another
  // clickable element (e.g. the location list row's expand-to-toggle
  // wrapper), cycling the format must not also trigger that handler.
  const cycle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFormat(
      (f) => GPS_FORMATS[(GPS_FORMATS.indexOf(f) + 1) % GPS_FORMATS.length]!,
    );
  };
  const text = formatGps(format, lat, lng, locale);

  const labelCls =
    tone === "dark"
      ? "text-xs font-medium uppercase tracking-wide text-red-300/80"
      : // default + brand share the green label; they differ in the value
        // colour below (default keeps a neutral gray coordinate).
        "text-xs font-medium uppercase tracking-wide text-brand-700";
  const valueCls =
    tone === "dark"
      ? "font-mono text-red-100"
      : tone === "brand"
        ? "font-mono text-brand-700"
        : "font-mono text-gray-800";
  const btnCls =
    tone === "dark"
      ? "rounded p-1 text-red-300/70 transition hover:bg-red-900/40 hover:text-red-100"
      : tone === "brand"
        ? "rounded p-1 text-brand-600 transition hover:bg-brand-50 hover:text-brand-800"
        : "rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-brand-700";

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={labelCls}>{t("label")}</span>
      <span className={valueCls}>{text}</span>
      <button
        type="button"
        onClick={cycle}
        aria-label={t("toggleFormat")}
        title={t("toggleFormat")}
        className={btnCls}
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
