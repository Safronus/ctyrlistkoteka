"use client";

import { useEffect, useRef } from "react";
import { GeoJSON as GeoJSONLayer, useMap } from "react-leaflet";
import type { Layer } from "leaflet";
import type { MapLocation } from "@/lib/queries/map";

export function LocationPolygons({
  locations,
  focusLocationId,
  enabledChildPolygonIds,
}: {
  locations: readonly MapLocation[];
  focusLocationId?: number | null;
  /** IDs of child locations whose polygons the user explicitly opted in
   *  via the sidebar toggle (or whose `?focus=` deep link auto-enabled
   *  them). Top-level locations always render their polygons; children
   *  only when present in this set so they don't stack on the parent
   *  by default. */
  enabledChildPolygonIds: ReadonlySet<number>;
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
    .map((l) => ({
      type: "Feature" as const,
      properties: { id: l.id, displayName: l.displayName, findCount: l.findCount },
      geometry: l.polygon,
    }));

  useEffect(() => {
    if (focusLocationId == null) return;
    const layer = layerRefs.current.get(focusLocationId);
    if (!layer || typeof (layer as Layer & { openPopup?: () => void }).openPopup !== "function") {
      return;
    }
    // FitBounds animates ~250 ms; wait for moveend (or fall back after a
    // short timeout in case it already fired by the time we attached).
    const open = () => {
      (layer as Layer & { openPopup: () => void }).openPopup();
    };
    map.once("moveend", open);
    const t = setTimeout(open, 800);
    return () => {
      map.off("moveend", open);
      clearTimeout(t);
    };
  }, [focusLocationId, map, features.length]);

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
        const id = (feature?.properties as { id?: number } | undefined)?.id;
        const focused = id != null && id === focusLocationId;
        // Non-focused polygons render in dark blue so the (also-clover-
        // green) find dots painted by FindDotsLayer stay visually
        // distinct. Focused polygon keeps its orange highlight.
        return {
          color: focused ? "#9a3412" : "#1e40af",
          weight: focused ? 3 : 2,
          fillColor: focused ? "#fb923c" : "#3b82f6",
          fillOpacity: focused ? 0.3 : 0.15,
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
