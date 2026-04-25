"use client";

import dynamic from "next/dynamic";
import type { CountryPoint } from "@/lib/queries/stats";

/**
 * { ssr: false } edge for the choropleth world map. Mirrors `MapLoader`
 * under /mapa — Leaflet touches `window` on import so the underlying
 * component must never enter the SSR bundle.
 */
const WorldChoroplethMap = dynamic(
  () =>
    import("./world-choropleth-map").then((m) => m.WorldChoroplethMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-96 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-400">
        Načítám mapu…
      </div>
    ),
  },
);

export function WorldChoroplethMapLoader({
  byCountry,
}: {
  byCountry: readonly CountryPoint[];
}) {
  return <WorldChoroplethMap byCountry={byCountry} />;
}
