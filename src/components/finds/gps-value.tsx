"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

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
      ? `${toAppleDms(lat, true)} ${toAppleDms(lng, false)}`
      : `${toVerboseDms(lat, true)} ${toVerboseDms(lng, false)}`;

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

function toAppleDms(deg: number, isLat: boolean): string {
  const { d, m, s } = toDmsParts(deg);
  const dir = direction(deg, isLat);
  const ss = padSeconds(s, 1);
  const mm = String(m).padStart(2, "0");
  return `${d}°${mm}'${ss}"${dir}`;
}

function toVerboseDms(deg: number, isLat: boolean): string {
  const { d, m, s } = toDmsParts(deg);
  const dir = direction(deg, isLat);
  const ss = padSeconds(s, 3);
  const mm = String(m).padStart(2, "0");
  return `${dir} ${d}° ${mm}' ${ss}"`;
}

function toDmsParts(deg: number): { d: number; m: number; s: number } {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const minTotal = (abs - d) * 60;
  const m = Math.floor(minTotal);
  const s = (minTotal - m) * 60;
  return { d, m, s };
}

function padSeconds(s: number, decimals: number): string {
  const fixed = s.toFixed(decimals);
  // Pad integer part to 2 digits so "9.5" → "09.5"
  const [intPart, decPart] = fixed.split(".");
  const padded = (intPart ?? "0").padStart(2, "0");
  return decPart ? `${padded}.${decPart}` : padded;
}

function direction(deg: number, isLat: boolean): string {
  if (isLat) return deg >= 0 ? "N" : "S";
  return deg >= 0 ? "E" : "W";
}
