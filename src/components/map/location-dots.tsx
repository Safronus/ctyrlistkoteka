"use client";

import { useEffect, useRef } from "react";
import { CircleMarker, useMap } from "react-leaflet";
import L, { type CircleMarker as LCircleMarker } from "leaflet";
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
  showGone,
  onSelect,
}: {
  locations: readonly MapLocation[];
  focusLocationId: number | null;
  /** Mirror the polygon-layer toggle: hide former-location dots when
   *  the visitor has the Zaniklé layer off. */
  showGone: boolean;
  onSelect?: (id: number) => void;
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

  const dots = locations
    .filter(
      (l): l is MapLocation & { centerLat: number; centerLng: number } =>
        l.polygon === null && l.centerLat !== null && l.centerLng !== null,
    )
    .filter((l) => showGone || !l.isGone);

  return (
    <>
      {dots.map((l) => {
        const focused = l.id === focusLocationId;
        // Three-hue palette mirrors LocationPolygons: blue for active,
        // rose for former, amber for the currently-focused row. Focus
        // wins over former so a selected gone location reads as
        // "you've selected this" rather than "this is also gone".
        const ring = focused
          ? "#b45309"
          : l.isGone
            ? "#9f1239"
            : "#1e40af";
        const fill = focused
          ? "#fbbf24"
          : l.isGone
            ? "#e11d48"
            : "#1e40af";
        return (
          <CircleMarker
            key={l.id}
            center={[l.centerLat, l.centerLng]}
            radius={focused ? 9 : 6}
            pathOptions={{
              color: ring,
              fillColor: fill,
              fillOpacity: focused ? 0.7 : 0.6,
              weight: focused ? 2 : 1,
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
              click: (e) => {
                // Stop the click from reaching the map's background
                // handler — otherwise the deselect would fire right
                // after the select.
                L.DomEvent.stopPropagation(e);
                onSelect?.(l.id);
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

