"use client";

import { useEffect } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { DROP_STATUS_COLOR, DROP_STATUS_LABEL } from "@/lib/admin/dropVocab";
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
  points,
  selectedId,
  onSelect,
  onPlace,
}: {
  center: [number, number];
  zoom: number;
  radiusM: number | null;
  points: MapPoint[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onPlace: (lat: number, lng: number) => void;
}) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom
      className="h-[28rem] w-full rounded-lg"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Recenter center={center} zoom={zoom} />
      <ClickToPlace onPlace={onPlace} />

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
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={selected ? 11 : 7}
            pathOptions={{
              color: selected ? "#111827" : DROP_STATUS_COLOR[p.status],
              weight: selected ? 3 : 2,
              fillColor: DROP_STATUS_COLOR[p.status],
              fillOpacity: 0.85,
            }}
            eventHandlers={{
              click: (e) => {
                // Selecting a marker must not also drop the selected card
                // onto it — stop the click before the map handler sees it.
                e.originalEvent.stopPropagation();
                onSelect(p.id);
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              <span className="text-xs">
                🍀 #{p.findId} · {DROP_STATUS_LABEL[p.status]}
                {p.placedBy && <> · {p.placedBy}</>}
                {p.scans > 0 && <> · {p.scans}× sken</>}
              </span>
            </Tooltip>
          </CircleMarker>
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
