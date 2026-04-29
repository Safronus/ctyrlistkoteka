"use client";

import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { type LatLngBoundsExpression } from "leaflet";
import { useEffect, useMemo } from "react";
import "leaflet/dist/leaflet.css";
import { LocationPolygons } from "./location-polygons";
import { LocationDots } from "./location-dots";
import { FindDotsLayer } from "./find-dots-layer";
import { HighlightFindMarker } from "./highlight-find-marker";
import type { MapData } from "@/lib/queries/map";
import type { HighlightFind } from "@/lib/queries/finds";

// Fallback view — Czech Republic bbox when no data is available.
const CZ_CENTER: [number, number] = [49.8, 15.5];
const CZ_ZOOM = 7;

export function MapView({
  data,
  focusLocationId,
  showLocations,
  showFinds,
  showGone,
  enabledChildPolygonIds,
  highlightFind,
}: {
  data: MapData;
  focusLocationId: number | null;
  showLocations: boolean;
  showFinds: boolean;
  showGone: boolean;
  enabledChildPolygonIds: ReadonlySet<number>;
  highlightFind: HighlightFind | null;
}) {
  // When highlighting a single find from /sbirka, the visitor wants to
  // see that point at street level — bypass the location-polygon fit
  // and synthesise a small bbox around the find's coords. Otherwise the
  // existing focus rules apply: location polygon (preferred) or a tiny
  // box around its centre point.
  const bounds = useMemo(() => {
    if (highlightFind) {
      const d = 0.0002; // ~22 m — lands fitBounds at a street-level zoom
      return [
        [highlightFind.lat - d, highlightFind.lng - d],
        [highlightFind.lat + d, highlightFind.lng + d],
      ] as LatLngBoundsExpression;
    }
    if (focusLocationId !== null) {
      const focused = data.locations.find((l) => l.id === focusLocationId);
      if (focused) {
        const fb = focusBounds(focused);
        if (fb) return fb;
      }
    }
    return computeBounds(data);
  }, [data, focusLocationId, highlightFind]);

  // Tighter maxZoom when focusing — for a single small AOI we want detail,
  // not a 14-zoom city overview. The highlight goes one tighter so the
  // pulsing marker fills the viewport.
  const maxFitZoom =
    highlightFind !== null ? 19 : focusLocationId !== null ? 19 : 14;

  // Highlight-by-focus: when the visitor picks a sidebar location (or
  // arrives via `?focus=N` from /lokality), build the set of location
  // ids whose finds should stay full-opacity on the canvas — the focus
  // itself plus any direct children, since /sbirka treats
  // parent-with-children as one logical group. Everything else fades to
  // 20 % so the picked spot's clovers pop out of the surrounding density.
  const focusFindIds = useMemo<ReadonlySet<number> | null>(() => {
    if (focusLocationId === null) return null;
    const set = new Set<number>();
    set.add(focusLocationId);
    for (const loc of data.locations) {
      if (loc.parentId === focusLocationId) set.add(loc.id);
    }
    return set;
  }, [focusLocationId, data.locations]);

  return (
    <MapContainer
      center={CZ_CENTER}
      zoom={CZ_ZOOM}
      scrollWheelZoom
      style={{ width: "100%", height: "100%" }}
      aria-label="Interaktivní mapa lokalit"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      {showLocations && (
        <>
          <LocationPolygons
            locations={data.locations}
            focusLocationId={focusLocationId}
            enabledChildPolygonIds={enabledChildPolygonIds}
            showGone={showGone}
            suppressPopupAutoOpen={highlightFind !== null}
          />
          <LocationDots
            locations={data.locations}
            focusLocationId={focusLocationId}
            showGone={showGone}
          />
        </>
      )}
      {showFinds && data.findCoords.length > 0 && (
        <FindDotsLayer
          coords={data.findCoords}
          focusFindIds={focusFindIds}
        />
      )}
      {highlightFind && <HighlightFindMarker find={highlightFind} />}
      {bounds && (
        <FitBounds
          bounds={bounds}
          maxZoom={maxFitZoom}
          focusKey={
            highlightFind !== null ? `find-${highlightFind.id}` : focusLocationId
          }
        />
      )}
    </MapContainer>
  );
}

/**
 * Auto-fits the map. `focusKey` forces a re-fit whenever the user picks
 * a new location from the sidebar — without it, useEffect deps wouldn't
 * change because `bounds` array identity stays the same shape.
 */
function FitBounds({
  bounds,
  maxZoom,
  focusKey,
}: {
  bounds: LatLngBoundsExpression;
  maxZoom: number;
  /** Identity token to force a re-fit when the visitor picks a new
   *  location or follows a new ?find=N deep link. The value itself
   *  doesn't matter — only that React sees a change. */
  focusKey: number | string | null;
}) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom });
  }, [map, bounds, maxZoom, focusKey]);
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
 * Pick the points to fit when no focus is given. Drops any point > 800
 * km from the median centroid so a couple of outlier locations (e.g.
 * Dublin, Reykjavík) don't zoom the view out across the Atlantic.
 */
function computeBounds(data: MapData): LatLngBoundsExpression | null {
  const points: Array<[number, number]> = data.locations
    .filter((l) => l.centerLat !== null && l.centerLng !== null)
    .map((l) => [l.centerLat as number, l.centerLng as number]);

  if (points.length === 0) return null;
  if (points.length <= 2) return points as LatLngBoundsExpression;

  const medLat = median(points.map((p) => p[0]));
  const medLng = median(points.map((p) => p[1]));
  const inliers = points.filter(
    ([lat, lng]) => haversineKm(lat, lng, medLat, medLng) < 800,
  );
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
