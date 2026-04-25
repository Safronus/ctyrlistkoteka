"use client";

import { useState } from "react";
import { ListIcon, X } from "lucide-react";
import { MapLoader } from "./map-loader";
import { MapSidebar } from "./map-sidebar";
import type { MapData } from "@/lib/queries/map";
import type { LocationListItem } from "@/lib/queries/locations";

/**
 * Wraps the Leaflet map and the right-hand sidebar in a single client
 * component so they can share state: which location is currently
 * focused, and whether the sidebar is open. Server data flows in once
 * via props; everything interactive is local.
 */
export function MapaShell({
  mapData,
  sidebarLocations,
  initialFocusId,
}: {
  mapData: MapData;
  sidebarLocations: readonly LocationListItem[];
  initialFocusId: number | null;
}) {
  const [focusId, setFocusId] = useState<number | null>(initialFocusId);
  // Sidebar opens automatically when the URL ships a focused location —
  // otherwise the user lands on /mapa with nothing in view that explains
  // what just happened.
  const [sidebarOpen, setSidebarOpen] = useState(initialFocusId !== null);

  return (
    <div className="relative h-full w-full">
      <MapLoader data={mapData} focusLocationId={focusId} />

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
          />
        </aside>
      )}
    </div>
  );
}
