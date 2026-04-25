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

export function MapView({
  data,
  focusLocationId,
}: {
  data: MapData;
  focusLocationId: number | null;
}) {
  // When focusing one location, ignore the wide auto-fit and zoom in on
  // that location's polygon (preferred — shows AOI shape) or its centre
  // point (fallback — synthesise a tiny ~80 m bbox so the view isn't
  // scrolled to a single pixel).
  const bounds = useMemo(() => {
    if (focusLocationId !== null) {
      const focused = data.locations.find((l) => l.id === focusLocationId);
      if (focused) {
        const fb = focusBounds(focused);
        if (fb) return fb;
      }
    }
    return computeBounds(data);
  }, [data, focusLocationId]);

  // Tighter maxZoom when focusing — for a single small AOI we want detail,
  // not a 14-zoom city overview.
  const maxFitZoom = focusLocationId !== null ? 19 : 14;

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
      <LocationPolygons
        locations={data.locations}
        focusLocationId={focusLocationId}
      />
      <FindMarkers markers={data.markers} />
      {bounds && <FitBounds bounds={bounds} maxZoom={maxFitZoom} />}
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
function FitBounds({
  bounds,
  maxZoom,
}: {
  bounds: LatLngBoundsExpression;
  maxZoom: number;
}) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom });
  }, [map, bounds, maxZoom]);
  return null;
}

/**
 * Bounds for a single focused location. Prefers the AOI polygon when set
 * so the user gets a clear sense of the search area; falls back to a
 * small box around the centre point when only the centre is known.
 */
function focusBounds(
  loc: MapData["locations"][number],
): LatLngBoundsExpression | null {
  if (loc.polygon) {
    const coords = loc.polygon.coordinates[0];
    if (coords && coords.length > 0) {
      return coords.map(([lng, lat]) => [lat, lng] as [number, number]);
    }
  }
  if (loc.centerLat !== null && loc.centerLng !== null) {
    // ~80 m square so the fitBounds zoom lands at street level (≈18-19)
    // rather than maxing at maxZoom because the bbox is degenerate.
    const d = 0.0004;
    return [
      [loc.centerLat - d, loc.centerLng - d],
      [loc.centerLat + d, loc.centerLng + d],
    ];
  }
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

/**
 * Pick the points to fit. Markers (with real GPS) win when present; only
 * fall back to location centres when no markers exist. Then drop any
 * point > 800 km from the median centroid — useful when one or two
 * outlier locations (e.g., Dublin, Reykjavík) would otherwise zoom the
 * view out across the whole Atlantic and hide the dense home cluster.
 */
function computeBounds(data: MapData): LatLngBoundsExpression | null {
  const points: Array<[number, number]> =
    data.markers.length > 0
      ? data.markers.map((m) => [m.lat, m.lng])
      : data.locations
          .filter((l) => l.centerLat !== null && l.centerLng !== null)
          .map((l) => [l.centerLat as number, l.centerLng as number]);

  if (points.length === 0) return null;
  if (points.length <= 2) return points as LatLngBoundsExpression;

  const medLat = median(points.map((p) => p[0]));
  const medLng = median(points.map((p) => p[1]));
  const inliers = points.filter(
    ([lat, lng]) => haversineKm(lat, lng, medLat, medLng) < 800,
  );
  // Need at least 2 points to make bounds; otherwise keep the originals.
  return (inliers.length >= 2 ? inliers : points) as LatLngBoundsExpression;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2
    ? (sorted[m] as number)
    : ((sorted[m - 1] as number) + (sorted[m] as number)) / 2;
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
