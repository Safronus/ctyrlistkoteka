"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { formatGpsApple, formatGpsVerbose } from "@/lib/gpsFormat";

type Format = "apple" | "verbose";

/**
 * Renders a (lat, lng) pair as DMS, with a button to cycle between two
 * common presentations:
 *   apple:   49°21'46.8"N 17°53'42.0"E   (Apple Maps style, suffix dir)
 *   verbose: N 49° 21' 56.530" E 17° 53' 21.120"  (prefix dir, more decimals)
 */
export function GpsValue({
  lat,
  lng,
  tone = "default",
}: {
  lat: number;
  lng: number;
  /** "default" — gray-on-white (used in /lokality and the regular
   *  find-detail header). "dark" — red-tinted, used by the hellish
   *  #666 detail where the surrounding background is dark. */
  tone?: "default" | "dark";
}) {
  const t = useTranslations("GpsValue");
  const [format, setFormat] = useState<Format>("apple");

  // Defensive stopPropagation — when the GPS row sits inside another
  // clickable element (e.g. the location list row's expand-to-toggle
  // wrapper), cycling the format must not also trigger that handler.
  const cycle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFormat((f) => (f === "apple" ? "verbose" : "apple"));
  };
  const text =
    format === "apple"
      ? formatGpsApple(lat, lng)
      : formatGpsVerbose(lat, lng);

  const labelCls =
    tone === "dark"
      ? "text-xs font-medium uppercase tracking-wide text-red-300/80"
      : "text-xs font-medium uppercase tracking-wide text-gray-500";
  const valueCls =
    tone === "dark" ? "font-mono text-red-100" : "font-mono text-gray-800";
  const btnCls =
    tone === "dark"
      ? "rounded p-1 text-red-300/70 transition hover:bg-red-900/40 hover:text-red-100"
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
