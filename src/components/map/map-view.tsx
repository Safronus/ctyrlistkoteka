"use client";

import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L, { type LatLngBoundsExpression } from "leaflet";
import { useEffect, useMemo } from "react";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { FindMarkers } from "./find-markers";
import { LocationPolygons } from "./location-polygons";
import { ImageOverlays } from "./image-overlays";
import type { MapData } from "@/lib/queries/map";

// Fallback view — Czech Republic bbox when no data is available.
const CZ_CENTER: [number, number] = [49.8, 15.5];
const CZ_ZOOM = 7;

export function MapView({ data }: { data: MapData }) {
  const bounds = useMemo(() => computeBounds(data), [data]);

  return (
    <MapContainer
      center={CZ_CENTER}
      zoom={CZ_ZOOM}
      scrollWheelZoom
      style={{ width: "100%", height: "100%" }}
      aria-label="Interaktivní mapa nálezů"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <ImageOverlays overlays={data.overlays} />
      <LocationPolygons locations={data.locations} />
      <FindMarkers markers={data.markers} />
      {bounds && <FitBounds bounds={bounds} />}
      <Legend
        markerCount={data.markers.length}
        locationCount={data.locations.length}
      />
    </MapContainer>
  );
}

/**
 * Auto-fits the map to all known data on first render. Separate component
 * because `useMap` can only be called inside MapContainer.
 */
function FitBounds({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [map, bounds]);
  return null;
}

/**
 * Small overlay legend, rendered as a Leaflet control so it stays positioned
 * regardless of map panning.
 */
function Legend({
  markerCount,
  locationCount,
}: {
  markerCount: number;
  locationCount: number;
}) {
  const map = useMap();
  useEffect(() => {
    const control = new L.Control({ position: "topright" });
    control.onAdd = () => {
      const div = L.DomUtil.create("div");
      div.innerHTML = `
        <div style="background:white;padding:8px 10px;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,.15);font:12px system-ui">
          <div style="font-weight:600;color:#111827;margin-bottom:4px">Legenda</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#4d9748;border:1.5px solid #fff"></span>
            <span style="color:#374151">Nálezy (${markerCount})</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#a855f7;border:1.5px solid #fff"></span>
            <span style="color:#374151">Anonymizované</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
            <span style="display:inline-block;width:10px;height:10px;background:rgba(77,151,72,.25);border:1.5px solid #4d9748"></span>
            <span style="color:#374151">Lokality (${locationCount})</span>
          </div>
        </div>
      `;
      L.DomEvent.disableClickPropagation(div);
      return div;
    };
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map, markerCount, locationCount]);
  return null;
}

function computeBounds(data: MapData): LatLngBoundsExpression | null {
  const pts: Array<[number, number]> = [];
  for (const m of data.markers) pts.push([m.lat, m.lng]);
  for (const l of data.locations) {
    if (l.centerLat !== null && l.centerLng !== null) {
      pts.push([l.centerLat, l.centerLng]);
    }
  }
  if (pts.length === 0) return null;
  return pts as LatLngBoundsExpression;
}
