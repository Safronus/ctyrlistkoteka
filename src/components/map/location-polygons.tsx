"use client";

import { useEffect, useRef } from "react";
import { GeoJSON as GeoJSONLayer, useMap } from "react-leaflet";
import type { Layer } from "leaflet";
import type { MapLocation } from "@/lib/queries/map";

export function LocationPolygons({
  locations,
  focusLocationId,
}: {
  locations: readonly MapLocation[];
  focusLocationId?: number | null;
}) {
  const map = useMap();
  // Layer ref by location id, populated by onEachFeature so we can later
  // openPopup() on whichever layer the focus param targets.
  const layerRefs = useRef<Map<number, Layer>>(new Map());

  const features: GeoJSON.Feature[] = locations
    .filter((l): l is MapLocation & { polygon: GeoJSON.Polygon } =>
      l.polygon !== null,
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
        return {
          color: focused ? "#9a3412" : "#4d9748",
          weight: focused ? 3 : 2,
          fillColor: focused ? "#fb923c" : "#4d9748",
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
