"use client";

import { useEffect, useRef } from "react";
import { GeoJSON as GeoJSONLayer, useMap } from "react-leaflet";
import type { Layer, LatLngBounds, LatLng } from "leaflet";
import type { MapLocation } from "@/lib/queries/map";

export function LocationPolygons({
  locations,
  focusLocationId,
  enabledChildPolygonIds,
  showGone,
  suppressPopupAutoOpen = false,
}: {
  locations: readonly MapLocation[];
  focusLocationId?: number | null;
  /** IDs of child locations whose polygons the user explicitly opted in
   *  via the sidebar toggle (or whose `?focus=` deep link auto-enabled
   *  them). Top-level locations always render their polygons; children
   *  only when present in this set so they don't stack on the parent
   *  by default. */
  enabledChildPolygonIds: ReadonlySet<number>;
  /** Whether former (NEEXISTUJE-) locations are visible. Default OFF
   *  via the Vrstvy card on /mapa — toggling this filter here keeps
   *  gone polygons out of the GeoJSON layer entirely instead of just
   *  styling them invisibly. */
  showGone: boolean;
  /** When true, the focused polygon stays styled but doesn't pop its
   *  own popup. Used by /mapa's `?find=N` deep-link so the highlighted
   *  find's popup wins instead of being clobbered by the polygon's. */
  suppressPopupAutoOpen?: boolean;
}) {
  const map = useMap();
  // Layer ref by location id, populated by onEachFeature so we can later
  // openPopup() on whichever layer the focus param targets.
  const layerRefs = useRef<Map<number, Layer>>(new Map());

  const features: GeoJSON.Feature[] = locations
    .filter((l): l is MapLocation & { polygon: GeoJSON.Polygon } =>
      l.polygon !== null,
    )
    .filter(
      (l) => l.parentId === null || enabledChildPolygonIds.has(l.id),
    )
    .filter((l) => showGone || !l.isGone)
    .map((l) => ({
      type: "Feature" as const,
      properties: {
        id: l.id,
        displayName: l.displayName,
        findCount: l.findCount,
        isGone: l.isGone,
      },
      geometry: l.polygon,
    }));

  useEffect(() => {
    if (focusLocationId == null) return;
    if (suppressPopupAutoOpen) return;
    const layer = layerRefs.current.get(focusLocationId);
    if (!layer) return;
    type PopupLayer = Layer & {
      openPopup: (latlng?: [number, number]) => void;
      getBounds?: () => LatLngBounds;
      getCenter?: () => LatLng;
    };
    const popupLayer = layer as PopupLayer;
    if (typeof popupLayer.openPopup !== "function") return;
    // Anchor the popup above the polygon — its tip lands on the north
    // edge mid-point so the popup body extends UP from the top of the
    // shape rather than covering its centre. Falls back to the layer's
    // default anchor (centre) if bounds/center accessors aren't there.
    let anchor: [number, number] | undefined;
    try {
      const bounds = popupLayer.getBounds?.();
      const center = popupLayer.getCenter?.();
      if (bounds && center) {
        anchor = [bounds.getNorth(), center.lng];
      }
    } catch {
      /* polygon may not be fully initialised yet — fall through to default */
    }
    // FitBounds animates ~250 ms; wait for moveend (or fall back after a
    // short timeout in case it already fired by the time we attached).
    const open = () => {
      popupLayer.openPopup(anchor);
    };
    map.once("moveend", open);
    const t = setTimeout(open, 800);
    return () => {
      map.off("moveend", open);
      clearTimeout(t);
    };
  }, [focusLocationId, map, features.length, suppressPopupAutoOpen]);

  if (features.length === 0) return null;

  const collection: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features,
  };

  return (
    <GeoJSONLayer
      key={features.length}
      data={collection}
      style={(feature) => {
        const props = feature?.properties as
          | { id?: number; isGone?: boolean }
          | undefined;
        const id = props?.id;
        const focused = id != null && id === focusLocationId;
        const gone = props?.isGone === true;
        // Three palettes, three distinct hues so the visitor can name
        // each at a glance without consulting the legend:
        //   active   — blue   (#1e40af / #3b82f6)
        //   former   — rose   (pink-red border + striped pattern fill)
        //   focused  — amber  (#b45309 / #fbbf24) — warm but clearly
        //              not pink, so a focused former location reads as
        //              "you've selected this", not "this is also gone".
        if (focused) {
          return {
            color: "#b45309",
            weight: 2,
            fillColor: "#fbbf24",
            fillOpacity: 0.45,
          };
        }
        if (gone) {
          return {
            color: "#be123c",
            weight: 1,
            fillColor: "url(#ctyr-former-stripes)",
            fillOpacity: 0.95,
          };
        }
        return {
          color: "#1e40af",
          weight: 1,
          fillColor: "#3b82f6",
          fillOpacity: 0.15,
        };
      }}
      onEachFeature={(feature, layer) => {
        const props = feature.properties as {
          id: number;
          displayName: string;
          findCount: number;
        };
        layer.bindPopup(
          `<div>
            <strong>${escapeHtml(props.displayName)}</strong><br/>
            <span style="color:#6b7280;font-size:12px">${props.findCount} nálezů</span>
          </div>`,
        );
        layerRefs.current.set(props.id, layer);
      }}
    />
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
