"use client";

import { useEffect, useRef } from "react";
import { GeoJSON as GeoJSONLayer, useMap } from "react-leaflet";
import L, { type Layer, type LatLngBounds, type LatLng } from "leaflet";
import type { MapLocation } from "@/lib/queries/map";
import { buildLocationPopupHtml } from "./location-popup";

export function LocationPolygons({
  locations,
  focusLocationId,
  enabledChildPolygonIds,
  showGone,
  suppressPopupAutoOpen = false,
  enablePopup = true,
  onSelect,
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
  /** When false, no Leaflet popup is bound to any polygon — used on
   *  mobile where the page renders its own `LocationTopSheet` instead.
   *  Default true so desktop callers don't need to opt in. The flag
   *  is also folded into the GeoJSON layer's React `key` below so a
   *  resize across the breakpoint cleanly recreates the layer with
   *  the new binding. */
  enablePopup?: boolean;
  /** Click handler — fired when the visitor clicks a polygon directly
   *  on the map. The wrapper stops the click from reaching the map's
   *  background handler so it doesn't deselect right after selecting. */
  onSelect?: (id: number) => void;
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
        code: l.code,
        displayName: l.displayName,
        findCount: l.findCount,
        isGone: l.isGone,
        isChild: l.parentId !== null,
      },
      geometry: l.polygon,
    }));

  useEffect(() => {
    if (focusLocationId == null) return;
    if (suppressPopupAutoOpen) return;
    if (!enablePopup) return; // popup not bound — top-sheet handles it
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
  }, [focusLocationId, map, features.length, suppressPopupAutoOpen, enablePopup]);

  if (features.length === 0) return null;

  const collection: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features,
  };

  // Content fingerprint for the React key — react-leaflet's <GeoJSON>
  // creates its underlying Leaflet layer ONCE per key and never reads
  // updates to the `data` prop afterwards. Keying solely by feature
  // count missed polygon edits that didn't change the count (the rsync-
  // a-replacement-map case the user reported), so the visitor saw a
  // stale shape until something else nudged the count. We mix in each
  // feature's id, ring length, and a couple of representative coords
  // so any meaningful polygon edit forces a clean remount with the
  // fresh data. O(features) per render, ~128 entries — cheap.
  const fingerprint = features
    .map((f) => {
      const id = (f.properties as { id?: number })?.id ?? 0;
      const ring = (f.geometry as GeoJSON.Polygon).coordinates[0] ?? [];
      const len = ring.length;
      const head = ring[0]?.map((n) => n.toFixed(5)).join(",") ?? "";
      const mid =
        ring[Math.floor(len / 2)]?.map((n) => n.toFixed(5)).join(",") ?? "";
      return `${id}:${len}:${head}:${mid}`;
    })
    .join("|");

  return (
    <GeoJSONLayer
      key={`${enablePopup ? "p" : "np"}-${fingerprint}`}
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
          code: string;
          displayName: string;
          findCount: number;
          isGone: boolean;
          isChild: boolean;
        };
        if (enablePopup) {
          layer.bindPopup(
            buildLocationPopupHtml({
              id: props.id,
              code: props.code,
              displayName: props.displayName,
              findCount: props.findCount,
              isGone: props.isGone,
              isChild: props.isChild,
            }),
          );
        }
        layer.on("click", (e) => {
          // Stop the click from reaching the map's background handler —
          // otherwise the deselect would fire right after the select.
          L.DomEvent.stopPropagation(e);
          onSelect?.(props.id);
        });
        layerRefs.current.set(props.id, layer);
      }}
    />
  );
}
