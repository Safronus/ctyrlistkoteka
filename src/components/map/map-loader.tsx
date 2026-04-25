"use client";

import dynamic from "next/dynamic";
import type { MapData } from "@/lib/queries/map";

/**
 * Dynamic import boundary. Leaflet touches `window` on module load, so
 * MapView MUST NOT be part of the SSR bundle. This shim is the designated
 * { ssr: false } edge — it's the only client file that imports MapView.
 */
const MapView = dynamic(
  () => import("./map-view").then((m) => m.MapView),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-400">Načítám mapu…</div>
      </div>
    ),
  },
);

export function MapLoader({
  data,
  focusLocationId,
}: {
  data: MapData;
  focusLocationId?: number | null;
}) {
  return <MapView data={data} focusLocationId={focusLocationId ?? null} />;
}
