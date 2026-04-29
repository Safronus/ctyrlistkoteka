"use client";

import { useEffect, useRef } from "react";
import { CircleMarker, useMap } from "react-leaflet";
import type { CircleMarker as LCircleMarker } from "leaflet";
import type { MapLocation } from "@/lib/queries/map";

/**
 * For locations with no AOI polygon recorded, render a small dot at the
 * map's centre point so the place is at least visible/clickable. With a
 * polygon, LocationPolygons handles it instead — this component is the
 * fallback layer.
 */
export function LocationDots({
  locations,
  focusLocationId,
}: {
  locations: readonly MapLocation[];
  focusLocationId: number | null;
}) {
  const map = useMap();
  const layerRefs = useRef<Map<number, LCircleMarker>>(new Map());

  // When focused, open the focused dot's popup once the map's fit-bounds
  // animation settles. Same pattern as LocationPolygons.
  useEffect(() => {
    if (focusLocationId == null) return;
    const layer = layerRefs.current.get(focusLocationId);
    if (!layer) return;
    const open = () => layer.openPopup();
    map.once("moveend", open);
    const t = setTimeout(open, 800);
    return () => {
      map.off("moveend", open);
      clearTimeout(t);
    };
  }, [focusLocationId, map]);

  const dots = locations.filter(
    (l): l is MapLocation & { centerLat: number; centerLng: number } =>
      l.polygon === null && l.centerLat !== null && l.centerLng !== null,
  );

  return (
    <>
      {dots.map((l) => {
        const focused = l.id === focusLocationId;
        // Match LocationPolygons palette: blue for active locations,
        // red for former (NEEXISTUJE-) locations, orange for the
        // currently-focused one (focus wins regardless of gone state).
        const ring = focused
          ? "#9a3412"
          : l.isGone
            ? "#991b1b"
            : "#1e40af";
        const fill = focused
          ? "#fb923c"
          : l.isGone
            ? "#dc2626"
            : "#1e40af";
        return (
          <CircleMarker
            key={l.id}
            center={[l.centerLat, l.centerLng]}
            radius={focused ? 9 : 6}
            pathOptions={{
              color: ring,
              fillColor: fill,
              fillOpacity: focused ? 0.7 : 0.55,
              weight: focused ? 3 : 2,
            }}
            eventHandlers={{
              add: (e) => {
                const layer = e.target as LCircleMarker;
                layer.bindPopup(
                  `<div>
                    <strong>${escapeHtml(l.displayName)}</strong><br/>
                    <span style="color:#6b7280;font-size:12px">${l.findCount} nálezů</span>
                  </div>`,
                );
                layerRefs.current.set(l.id, layer);
              },
              remove: () => {
                layerRefs.current.delete(l.id);
              },
            }}
          />
        );
      })}
    </>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

