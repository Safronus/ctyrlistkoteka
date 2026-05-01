"use client";

import { useEffect, useRef } from "react";
import { CircleMarker, useMap } from "react-leaflet";
import { useRouter } from "next/navigation";
import L, { type CircleMarker as LCircleMarker } from "leaflet";
import type { MapLocation } from "@/lib/queries/map";
import { buildLocationPopupHtml } from "./location-popup";
import { locationDetailHref } from "@/lib/format";

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
  suppressPopupAutoOpen = false,
  onSelect,
}: {
  locations: readonly MapLocation[];
  focusLocationId: number | null;
  /** Mirror the polygon-layer toggle: hide former-location dots when
   *  the visitor has the Zaniklé layer off. */
  showGone: boolean;
  /** When true, the focused dot stays styled but doesn't pop its own
   *  popup. Mirrors the same flag on LocationPolygons — used by /mapa's
   *  `?find=N` deep-link so the highlighted find's popup wins. Without
   *  this, a single-find location with only a centre point (no AOI)
   *  would auto-open its popup and clobber the marker, dismissing the
   *  highlight in the process. */
  suppressPopupAutoOpen?: boolean;
  onSelect?: (id: number) => void;
}) {
  const map = useMap();
  const router = useRouter();
  const layerRefs = useRef<Map<number, LCircleMarker>>(new Map());
  // Manual double-click detection — see LocationPolygons for the
  // rationale. Closing one popup before opening another can swallow
  // one click of a real dblclick, so we track timestamps in refs and
  // navigate when two clicks land on the same dot inside the window.
  // navigatedAtRef deduplicates against Leaflet's own dblclick.
  const lastClickRef = useRef<{ id: number; at: number }>({ id: -1, at: 0 });
  const navigatedAtRef = useRef(0);
  const DOUBLE_CLICK_MS = 400;
  const NAVIGATE_DEDUPE_MS = 800;

  // When focused, open the focused dot's popup once the map's fit-bounds
  // animation settles. Same pattern as LocationPolygons.
  useEffect(() => {
    if (focusLocationId == null) return;
    if (suppressPopupAutoOpen) return;
    const layer = layerRefs.current.get(focusLocationId);
    if (!layer) return;
    const open = () => layer.openPopup();
    map.once("moveend", open);
    const t = setTimeout(open, 800);
    return () => {
      map.off("moveend", open);
      clearTimeout(t);
    };
  }, [focusLocationId, map, suppressPopupAutoOpen]);

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
                  buildLocationPopupHtml({
                    id: l.id,
                    code: l.code,
                    displayName: l.displayName,
                    findCount: l.findCount,
                    isGone: l.isGone,
                    isChild: l.parentId !== null,
                  }),
                );
                layerRefs.current.set(l.id, layer);
              },
              click: (e) => {
                // Stop the click from reaching the map's background
                // handler — otherwise the deselect would fire right
                // after the select.
                L.DomEvent.stopPropagation(e);
                const now = Date.now();
                const last = lastClickRef.current;
                if (last.id === l.id && now - last.at < DOUBLE_CLICK_MS) {
                  if (
                    now - navigatedAtRef.current >= NAVIGATE_DEDUPE_MS
                  ) {
                    navigatedAtRef.current = now;
                    lastClickRef.current = { id: -1, at: 0 };
                    router.push(locationDetailHref(l.id));
                  }
                  return;
                }
                lastClickRef.current = { id: l.id, at: now };
                onSelect?.(l.id);
              },
              dblclick: (e) => {
                // Mirror the polygon-layer behaviour: dvojklik opens
                // the detail page. stopPropagation suppresses Leaflet's
                // map-level doubleClickZoom that would otherwise zoom
                // in before the navigation finishes; the dedupe window
                // means we never navigate twice when both the manual
                // click detector and Leaflet's dblclick fire for the
                // same gesture.
                L.DomEvent.stopPropagation(e);
                e.originalEvent?.preventDefault();
                const now = Date.now();
                if (now - navigatedAtRef.current < NAVIGATE_DEDUPE_MS) return;
                navigatedAtRef.current = now;
                lastClickRef.current = { id: -1, at: 0 };
                router.push(locationDetailHref(l.id));
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

