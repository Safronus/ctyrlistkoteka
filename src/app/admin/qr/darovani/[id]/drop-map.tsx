"use client";

import { useEffect, useRef } from "react";
import {
  Circle,
  GeoJSON,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DROP_STATUS_COLOR, DROP_STATUS_LABEL } from "@/lib/admin/dropVocab";
import { boundaryBBox, type BoundaryGeometry } from "@/lib/admin/dropBoundary";
import { dropCloverIcon } from "@/components/map/drop-clover-icon";
import type { DropStatus } from "@/generated/prisma/enums";

export interface MapPoint {
  id: number;
  findId: number;
  status: DropStatus;
  lat: number;
  lng: number;
  scans: number;
  placedBy: string | null;
}

/**
 * Admin-only map of one area's hiding places.
 *
 * Never rendered on a public route: the whole point of the game is that
 * nobody can look these up. Markers are coloured by lifecycle so a glance
 * says how much of the wave is still sitting at home.
 *
 * Clicking empty map moves the SELECTED card there; clicking a marker
 * selects that card instead. Two verbs, one click each — no drag, which
 * on a touch screen fights the map's own panning.
 */
export function DropMap({
  center,
  zoom,
  radiusM,
  boundary,
  points,
  selectedId,
  fitToken,
  onSelect,
  onPlace,
}: {
  center: [number, number];
  zoom: number;
  radiusM: number | null;
  boundary: BoundaryGeometry | null;
  points: MapPoint[];
  selectedId: number | null;
  /** Bumped by the panel's "fit" button; any change refits the view. */
  fitToken: number;
  onSelect: (id: number) => void;
  onPlace: (lat: number, lng: number) => void;
}) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom
      // The placing cursor is driven from the WRAPPER in area-map-panel,
      // not from here: react-leaflet reads MapContainer's className once
      // at mount and never again, so toggling it on selection did nothing.
      className="h-[56rem] max-h-[80vh] w-full rounded-lg"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Recenter center={center} zoom={zoom} />
      <FitEverything
        token={fitToken}
        boundary={boundary}
        center={center}
        radiusM={radiusM}
        points={points}
      />
      <ClickToPlace onPlace={onPlace} />

      {/* Drawn first so markers stay clickable on top of it. */}
      {boundary && (
        <GeoJSON
          key={JSON.stringify(boundaryBBox(boundary))}
          data={boundary as never}
          // Non-interactive: a click on the town must still place a card,
          // not get swallowed by the polygon.
          interactive={false}
          style={{
            color: "#0f766e",
            weight: 2,
            fillColor: "#14b8a6",
            fillOpacity: 0.07,
          }}
        />
      )}

      {radiusM !== null && (
        <Circle
          center={center}
          radius={radiusM}
          pathOptions={{
            color: "#0284c7",
            weight: 1,
            dashArray: "4 4",
            fillOpacity: 0.04,
          }}
        />
      )}

      {points.map((p) => {
        const selected = p.id === selectedId;
        return (
          <Marker
            key={p.id}
            position={[p.lat, p.lng]}
            icon={dropCloverIcon(DROP_STATUS_COLOR[p.status], selected)}
            eventHandlers={{
              click: (e) => {
                // Selecting a marker must not also drop the selected card
                // onto it — stop the click before the map handler sees it.
                e.originalEvent.stopPropagation();
                onSelect(p.id);
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -10]}>
              <span className="text-xs">
                🍀 #{p.findId} · {DROP_STATUS_LABEL[p.status]}
                {p.placedBy && <> · {p.placedBy}</>}
                {p.scans > 0 && <> · {p.scans}× sken</>}
              </span>
            </Tooltip>
          </Marker>
        );
      })}
    </MapContainer>
  );
}

/** Follows the area's centre/zoom when the operator edits them. */
function Recenter({
  center,
  zoom,
}: {
  center: [number, number];
  zoom: number;
}) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
    // Only when the AREA changes — not on every render, which would fight
    // the operator's own panning.
  }, [map, center[0], center[1], zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * Frames the whole area on demand: the town outline if there is one, plus
 * every placed card and the scatter circle.
 *
 * On a token rather than on data, because refitting whenever a card moves
 * would drag the map out from under the operator mid-placement — the one
 * thing this must not do.
 */
function FitEverything({
  token,
  boundary,
  center,
  radiusM,
  points,
}: {
  token: number;
  boundary: BoundaryGeometry | null;
  center: [number, number];
  radiusM: number | null;
  points: MapPoint[];
}) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    // Skip the mount pass — the area's own centre/zoom own the first view.
    if (first.current) {
      first.current = false;
      return;
    }
    const bounds = L.latLngBounds([]);
    if (boundary) {
      const b = boundaryBBox(boundary);
      bounds.extend([b.minLat, b.minLng]);
      bounds.extend([b.maxLat, b.maxLng]);
    }
    for (const p of points) bounds.extend([p.lat, p.lng]);
    if (!boundary && radiusM !== null) {
      // A circle has no bounds of its own here; approximate from the
      // radius so "fit" still means something for an area without a shape.
      const dLat = radiusM / 111_132;
      const dLng = radiusM / (111_320 * Math.cos((center[0] * Math.PI) / 180));
      bounds.extend([center[0] - dLat, center[1] - dLng]);
      bounds.extend([center[0] + dLat, center[1] + dLng]);
    }
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
    else map.setView(center, 13);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function ClickToPlace({
  onPlace,
}: {
  onPlace: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}
