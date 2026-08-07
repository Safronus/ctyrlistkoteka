"use client";

import { useEffect } from "react";
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
  onSelect,
  onPlace,
}: {
  center: [number, number];
  zoom: number;
  radiusM: number | null;
  boundary: BoundaryGeometry | null;
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
            icon={cloverIcon(DROP_STATUS_COLOR[p.status], selected)}
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

/**
 * The same four-circle clover the public /mapa paints for a find, tinted
 * by lifecycle instead of by theme.
 *
 * A coloured dot said "a thing is here"; the clover says WHAT is here,
 * which matters on a map that also carries a town outline and a scatter
 * circle. Selection gets a dark ring rather than a bigger shape, so the
 * markers keep their size and the eye tracks the position, not the blob.
 *
 * Cached per (colour, selected): Leaflet re-renders a marker's DOM
 * whenever its `icon` prop is a new object, and a hundred of them
 * re-rendering on every pan is exactly the jank this map cannot afford.
 */
const ICON_BOX = 24;
const iconCache = new Map<string, L.DivIcon>();

function cloverIcon(color: string, selected: boolean): L.DivIcon {
  const key = `${color}|${selected}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const icon = L.divIcon({
    className: "",
    html: `
      <svg viewBox="0 0 32 32" width="${ICON_BOX}" height="${ICON_BOX}" aria-hidden="true" focusable="false">
        <circle cx="16" cy="16" r="15" fill="#ffffff" opacity="0.9" />
        ${selected ? '<circle cx="16" cy="16" r="15" fill="none" stroke="#111827" stroke-width="2.5" />' : ""}
        <g fill="${color}">
          <circle cx="16" cy="11" r="5" />
          <circle cx="11" cy="16" r="5" />
          <circle cx="21" cy="16" r="5" />
          <circle cx="16" cy="21" r="5" />
        </g>
        <circle cx="16" cy="16" r="3" fill="${color}" stroke="#ffffff" stroke-width="1" />
      </svg>`,
    iconSize: [ICON_BOX, ICON_BOX],
    iconAnchor: [ICON_BOX / 2, ICON_BOX / 2],
  });
  iconCache.set(key, icon);
  return icon;
}
