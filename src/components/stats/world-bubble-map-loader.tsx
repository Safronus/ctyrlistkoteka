"use client";

import dynamic from "next/dynamic";
import type { LocationGeoPoint } from "@/lib/queries/stats";

/**
 * { ssr: false } edge for the world bubble map. Mirrors `MapLoader`
 * under /mapa — Leaflet touches `window` on import so the underlying
 * component must never enter the SSR bundle.
 */
const WorldBubbleMap = dynamic(
  () => import("./world-bubble-map").then((m) => m.WorldBubbleMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-96 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-400">
        Načítám mapu…
      </div>
    ),
  },
);

export function WorldBubbleMapLoader({
  points,
}: {
  points: readonly LocationGeoPoint[];
}) {
  return <WorldBubbleMap points={points} />;
}
