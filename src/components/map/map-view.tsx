"use client";

import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { type LatLngBoundsExpression } from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
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
  initialFitLocationId,
  showLocations,
  showFinds,
  showGone,
  hideDeviatedFinds,
  enabledChildPolygonIds,
  highlightFind,
  highlightFindIds,
  onSelectLocation,
  onDeselectLocation,
  onHighlightDismiss,
  enableLocationPopup,
}: {
  data: MapData;
  focusLocationId: number | null;
  /** Location id used for the very first fit on mount when nothing is
   *  selected yet — typically MAP 00001. Lets `/mapa` open centred on
   *  familiar territory without painting an orange "selected" highlight. */
  initialFitLocationId: number | null;
  showLocations: boolean;
  showFinds: boolean;
  showGone: boolean;
  /** Vrstvy → Nálezy → "Skrýt odchýlené nálezy" sub-toggle. Skips
   *  finds whose `deviated` server flag is set so the canvas isn't
   *  cluttered with GPS outliers. */
  hideDeviatedFinds: boolean;
  enabledChildPolygonIds: ReadonlySet<number>;
  highlightFind: HighlightFind | null;
  /** Find IDs to keep bright on the canvas — typically populated when
   *  /mapa receives /sbirka filter params, so the visitor can see the
   *  filtered set against the dimmed rest. Wins over the location-focus
   *  dim when both are set. */
  highlightFindIds: ReadonlySet<number> | null;
  onSelectLocation: (id: number) => void;
  /** Fired when the visitor clicks empty map space — drops the highlight
   *  without re-fitting the viewport. */
  onDeselectLocation: () => void;
  /** Fired when the highlighted-find popup closes (X / Esc / outside
   *  click). Lets MapaShell drop the deep-link highlight and switch to
   *  normal interaction without panning the viewport. */
  onHighlightDismiss: () => void;
  /** Whether the polygon/dot layers should bind a Leaflet popup. Set
   *  false on mobile where the LocationTopSheet handles surfacing the
   *  location detail instead. */
  enableLocationPopup: boolean;
}) {
  const t = useTranslations("Mapa");
  const tStats = useTranslations("Statistiky");
  const locale = useLocale();
  const intlLocale =
    locale === "cs" ? "cs-CZ" : locale === "en" ? "en-GB" : locale;
  const popupLabels = useMemo(
    () => ({
      subPart: t("popupSubPart"),
      gone: t("popupGone"),
      detail: t("popupDetail"),
      showFinds: t("popupShowFinds"),
      findsLabel: (count: number) => tStats("labelFinds", { count }),
      numFmt: new Intl.NumberFormat(intlLocale),
    }),
    [t, tStats, intlLocale],
  );
  // When highlighting a single find from /sbirka, the visitor wants to
  // see that point at street level — bypass the location-polygon fit
  // and synthesise a small bbox around the find's coords. Otherwise the
  // existing focus rules apply: location polygon (preferred) or a tiny
  // box around its centre point. Without focus, fall back to the
  // initial-fit location (default 00001) instead of the wide world.
  const bounds = useMemo(() => {
    if (highlightFind) {
      const d = 0.0002; // ~22 m — lands fitBounds at a street-level zoom
      return [
        [highlightFind.lat - d, highlightFind.lng - d],
        [highlightFind.lat + d, highlightFind.lng + d],
      ] as LatLngBoundsExpression;
    }
    const targetId =
      focusLocationId ?? initialFitLocationId ?? null;
    if (targetId !== null) {
      const target = data.locations.find((l) => l.id === targetId);
      if (target) {
        const fb = focusBounds(target);
        if (fb) return fb;
      }
    }
    return computeBounds(data);
  }, [data, focusLocationId, initialFitLocationId, highlightFind]);

  // Tighter maxZoom when focusing — for a single small AOI we want detail,
  // not a 14-zoom city overview. The initial-fit location is a single
  // AOI too (default 00001), so it deserves the close-up zoom; without
  // this the bare /mapa visit would land at zoom 14, way too zoomed-out
  // for a small AOI.
  const maxFitZoom =
    highlightFind !== null
      ? 19
      : focusLocationId !== null
        ? 19
        : initialFitLocationId !== null
          ? 19
          : 14;

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
      aria-label={t("mapAria")}
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
            enablePopup={enableLocationPopup}
            popupLabels={popupLabels}
            onSelect={onSelectLocation}
          />
          <LocationDots
            locations={data.locations}
            focusLocationId={focusLocationId}
            showGone={showGone}
            suppressPopupAutoOpen={highlightFind !== null}
            enablePopup={enableLocationPopup}
            popupLabels={popupLabels}
            onSelect={onSelectLocation}
          />
        </>
      )}
      {showFinds && data.findCoords.length > 0 && (
        <FindDotsLayer
          coords={data.findCoords}
          focusFindIds={focusFindIds}
          highlightFindIds={highlightFindIds}
          hideDeviated={hideDeviatedFinds}
        />
      )}
      {highlightFind && (
        <HighlightFindMarker
          find={highlightFind}
          onPopupClose={onHighlightDismiss}
        />
      )}
      <BackgroundClickHandler onDeselect={onDeselectLocation} />
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
 * Auto-fits the map on initial mount and whenever the visitor picks a
 * new location. Deselecting (focusKey → null) intentionally does NOT
 * refit — the map stays where the user was, just without the highlight.
 */
function FitBounds({
  bounds,
  maxZoom,
  focusKey,
}: {
  bounds: LatLngBoundsExpression;
  maxZoom: number;
  /** Identity token. On mount, FitBounds always fits once (the initial
   *  centring on MAP 00001 or a deep-linked location). After mount, it
   *  refits only when the key changes to a non-null value. */
  focusKey: number | string | null;
}) {
  const map = useMap();
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      // First effect run after MapContainer mounts — always fit so the
      // viewport lands on the initial location (or deep-link target).
      didMountRef.current = true;
      map.fitBounds(bounds, { padding: [40, 40], maxZoom });
      return;
    }
    if (focusKey === null) return; // deselect — leave the viewport alone
    map.fitBounds(bounds, { padding: [40, 40], maxZoom });
    // bounds intentionally left out of deps: a focusKey change is the
    // signal we want; bounds reference can swing as the user toggles
    // gone/finds layers and we don't want each toggle to refit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, focusKey, maxZoom]);
  return null;
}

/**
 * Listens for clicks on empty map space and forwards them as a deselect
 * signal. Layer click handlers (polygons, dots) call
 * L.DomEvent.stopPropagation so their picks never reach this fallback.
 */
function BackgroundClickHandler({
  onDeselect,
}: {
  onDeselect: () => void;
}) {
  useMapEvents({
    click: () => onDeselect(),
  });
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
