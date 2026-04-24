"use client";

import { GeoJSON as GeoJSONLayer } from "react-leaflet";
import type { MapLocation } from "@/lib/queries/map";

export function LocationPolygons({
  locations,
}: {
  locations: readonly MapLocation[];
}) {
  const features: GeoJSON.Feature[] = locations
    .filter((l): l is MapLocation & { polygon: GeoJSON.Polygon } =>
      l.polygon !== null,
    )
    .map((l) => ({
      type: "Feature" as const,
      properties: { id: l.id, displayName: l.displayName, findCount: l.findCount },
      geometry: l.polygon,
    }));

  if (features.length === 0) return null;

  const collection: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features,
  };

  return (
    <GeoJSONLayer
      key={features.length}
      data={collection}
      style={{
        color: "#4d9748",
        weight: 2,
        fillColor: "#4d9748",
        fillOpacity: 0.15,
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
