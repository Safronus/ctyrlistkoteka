"use client";

import dynamic from "next/dynamic";
import type { MapData } from "@/lib/queries/map";
import type { HighlightFind } from "@/lib/queries/finds";

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
  initialFitLocationId,
  showLocations,
  showFinds,
  showGone,
  enabledChildPolygonIds,
  highlightFind,
  highlightFindIds,
  onSelectLocation,
  onDeselectLocation,
  onHighlightDismiss,
  enableLocationPopup,
}: {
  data: MapData;
  focusLocationId?: number | null;
  initialFitLocationId: number | null;
  showLocations: boolean;
  showFinds: boolean;
  showGone: boolean;
  enabledChildPolygonIds: ReadonlySet<number>;
  highlightFind: HighlightFind | null;
  highlightFindIds: ReadonlySet<number> | null;
  onSelectLocation: (id: number) => void;
  onDeselectLocation: () => void;
  onHighlightDismiss: () => void;
  /** Whether the polygon/dot layers should bind a Leaflet popup. False
   *  on mobile where MapaShell renders its own LocationTopSheet
   *  instead — the two would otherwise compete for the screen. */
  enableLocationPopup: boolean;
}) {
  return (
    <MapView
      data={data}
      focusLocationId={focusLocationId ?? null}
      initialFitLocationId={initialFitLocationId}
      showLocations={showLocations}
      showFinds={showFinds}
      showGone={showGone}
      enabledChildPolygonIds={enabledChildPolygonIds}
      highlightFind={highlightFind}
      highlightFindIds={highlightFindIds}
      onSelectLocation={onSelectLocation}
      onDeselectLocation={onDeselectLocation}
      onHighlightDismiss={onHighlightDismiss}
      enableLocationPopup={enableLocationPopup}
    />
  );
}
