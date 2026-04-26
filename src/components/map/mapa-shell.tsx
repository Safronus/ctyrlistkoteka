"use client";

import { useEffect, useState } from "react";
import { Info, ListIcon, X } from "lucide-react";
import { MapLoader } from "./map-loader";
import { MapSidebar } from "./map-sidebar";
import type { MapData } from "@/lib/queries/map";
import type { LocationListItem } from "@/lib/queries/locations";

/**
 * Wraps the Leaflet map and the right-hand sidebar in a single client
 * component so they can share state: which location is currently
 * focused, whether the sidebar is open, and which overlay layers are
 * visible. Server data flows in once via props; everything interactive
 * is local.
 */
// Default location to focus when the URL doesn't specify one. Matches
// "lokalita 00001" — typically ZLÍN_JSVAHY-UTB-U5-001. Falls back to the
// first available location if id 1 doesn't exist anymore.
const DEFAULT_FOCUS_ID = 1;

// localStorage keys for visitor-level layer preferences. CLAUDE.md §3
// allows localStorage for UI preferences — toggling map overlays
// qualifies. SSR can't read localStorage, so the first paint always
// shows the default (ON); the effect below rehydrates after mount.
const LS_KEY_LOCATIONS = "mapa.layers.locations";
const LS_KEY_FINDS = "mapa.layers.finds";

export function MapaShell({
  mapData,
  sidebarLocations,
  urlFocusId,
}: {
  mapData: MapData;
  sidebarLocations: readonly LocationListItem[];
  urlFocusId: number | null;
}) {
  // Default focus picks DEFAULT_FOCUS_ID when present in the data;
  // otherwise the first location; otherwise null (no data at all).
  const fallbackFocusId =
    mapData.locations.find((l) => l.id === DEFAULT_FOCUS_ID)?.id ??
    mapData.locations[0]?.id ??
    null;
  const [focusId, setFocusId] = useState<number | null>(
    urlFocusId ?? fallbackFocusId,
  );
  // Sidebar only auto-opens when the URL explicitly carried ?focus=N
  // (deep-link from /lokality). A bare /mapa visit keeps it closed even
  // though we still focus the default location on the map.
  const [sidebarOpen, setSidebarOpen] = useState(urlFocusId !== null);

  const [showLocations, setShowLocations] = useState(true);
  const [showFinds, setShowFinds] = useState(true);

  // Rehydrate visitor preferences after mount. Wrapped in try/catch
  // because localStorage can throw in private mode / when disabled.
  useEffect(() => {
    try {
      const sl = window.localStorage.getItem(LS_KEY_LOCATIONS);
      if (sl === "false") setShowLocations(false);
      const sf = window.localStorage.getItem(LS_KEY_FINDS);
      if (sf === "false") setShowFinds(false);
    } catch {
      /* localStorage unavailable — keep defaults */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY_LOCATIONS, String(showLocations));
    } catch {
      /* ignore */
    }
  }, [showLocations]);
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY_FINDS, String(showFinds));
    } catch {
      /* ignore */
    }
  }, [showFinds]);

  return (
    <div className="relative h-full w-full">
      <MapLoader
        data={mapData}
        focusLocationId={focusId}
        showLocations={showLocations}
        showFinds={showFinds}
      />

      {/* GPS-accuracy notice. Pinned bottom-left so it sits above OSM
          attribution but stays clear of the sidebar (right) and zoom
          controls (top-left). Only relevant when the find dots are
          actually drawn — hidden when the layer is off or empty. */}
      {showFinds && mapData.findCoords.length > 0 && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-6 left-3 z-[400] max-w-xs rounded-md border border-amber-200 bg-amber-50/95 px-3 py-2 text-xs text-amber-900 shadow-md"
        >
          <p className="flex items-start gap-1.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Pozice nálezů jsou orientační — mohou se lišit od reálné
              polohy kvůli odchylce GPS.
            </span>
          </p>
        </div>
      )}

      {/* Toggle pill — hidden when the sidebar itself is open since it
          carries its own close button. */}
      {!sidebarOpen && (
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="absolute right-3 top-3 z-[400] inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-md transition hover:border-brand-200 hover:text-brand-700"
          aria-label="Otevřít seznam lokalit"
        >
          <ListIcon className="h-4 w-4" aria-hidden />
          <span>Lokality ({sidebarLocations.length})</span>
        </button>
      )}

      {sidebarOpen && (
        <aside
          className="absolute right-0 top-0 z-[400] flex h-full w-80 max-w-[90vw] flex-col border-l border-gray-200 bg-white shadow-xl sm:w-96"
          aria-label="Seznam lokalit"
        >
          <header className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
            <h2 className="text-sm font-semibold text-gray-900">
              Lokality ({sidebarLocations.length})
            </h2>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              aria-label="Zavřít seznam"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </header>
          <MapSidebar
            locations={sidebarLocations}
            focusId={focusId}
            onSelect={setFocusId}
            showLocations={showLocations}
            onToggleLocations={setShowLocations}
            showFinds={showFinds}
            onToggleFinds={setShowFinds}
            findCount={mapData.findCoords.length}
          />
        </aside>
      )}
    </div>
  );
}
