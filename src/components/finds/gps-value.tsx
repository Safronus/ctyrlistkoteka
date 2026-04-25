"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { formatGpsApple, formatGpsVerbose } from "@/lib/gpsFormat";

type Format = "apple" | "verbose";

/**
 * Renders a (lat, lng) pair as DMS, with a button to cycle between two
 * common presentations:
 *   apple:   49°21'46.8"N 17°53'42.0"E   (Apple Maps style, suffix dir)
 *   verbose: N 49° 21' 56.530" E 17° 53' 21.120"  (prefix dir, more decimals)
 */
export function GpsValue({ lat, lng }: { lat: number; lng: number }) {
  const [format, setFormat] = useState<Format>("apple");

  const cycle = () => setFormat((f) => (f === "apple" ? "verbose" : "apple"));
  const text =
    format === "apple"
      ? formatGpsApple(lat, lng)
      : formatGpsVerbose(lat, lng);

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
        GPS
      </span>
      <span className="font-mono text-gray-800">{text}</span>
      <button
        type="button"
        onClick={cycle}
        aria-label="Přepnout formát GPS"
        title="Přepnout formát GPS"
        className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-brand-700"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
