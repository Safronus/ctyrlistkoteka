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
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DROP_STATUS_COLOR, DROP_STATUS_LABEL } from "@/lib/admin/dropVocab";
import { boundaryBBox, type BoundaryGeometry } from "@/lib/admin/dropBoundary";
import { dropCloverIcon } from "@/components/map/drop-clover-icon";
import type { DropStatus } from "@/generated/prisma/enums";

export interface CrewPoint {
  id: number;
  findId: number;
  status: DropStatus;
  lat: number;
  lng: number;
  placedBy: string | null;
  teamNote: string;
}

/**
 * The crew's own map: the same shapes the admin draws, minus every verb.
 *
 * Nothing here writes. A tap selects a card so the list below can scroll
 * to it — it can never move one, which is the difference between a map the
 * whole crew may open and the admin's placement tool.
 */
export function CrewMap({
  center,
  zoom,
  radiusM,
  boundary,
  points,
  selectedId,
  fitToken,
  onSelect,
}: {
  center: [number, number];
  zoom: number;
  radiusM: number | null;
  boundary: BoundaryGeometry | null;
  points: CrewPoint[];
  selectedId: number | null;
  /** Bumped by the "celá oblast" button; any change refits the view. */
  fitToken: number;
  onSelect: (id: number) => void;
}) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom
      className="h-[32rem] max-h-[70vh] w-full rounded-xl"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitEverything
        token={fitToken}
        boundary={boundary}
        center={center}
        radiusM={radiusM}
        points={points}
      />
      <PanToSelected points={points} selectedId={selectedId} />

      {boundary && (
        <GeoJSON
          key={JSON.stringify(boundaryBBox(boundary))}
          data={boundary as never}
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
          interactive={false}
          pathOptions={{
            color: "#0284c7",
            weight: 1,
            dashArray: "4 4",
            fillOpacity: 0.04,
          }}
        />
      )}

      {points.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={dropCloverIcon(DROP_STATUS_COLOR[p.status], p.id === selectedId)}
          eventHandlers={{ click: () => onSelect(p.id) }}
        >
          <Tooltip direction="top" offset={[0, -10]}>
            <span className="text-xs">
              🍀 #{p.findId} · {DROP_STATUS_LABEL[p.status]}
              {p.placedBy && <> · {p.placedBy}</>}
            </span>
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}

/** Frames the town outline, the scatter circle and every card. */
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
  points: CrewPoint[];
}) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    // Unlike the admin's version this DOES run on mount: a crew member
    // opening the link wants to see the cards, not the operator's saved
    // zoom on an empty corner of town.
    //
    // On mount the CARDS decide the view and the town outline is ignored:
    // an OSM boundary can be the whole district, and fitting it drops
    // eleven markers into a thumbnail in the middle of nowhere. The
    // "celá oblast" button then does include it — that is what it is for.
    const initial = first.current && points.length > 0;
    const bounds = L.latLngBounds([]);
    if (boundary && !initial) {
      const b = boundaryBBox(boundary);
      bounds.extend([b.minLat, b.minLng]);
      bounds.extend([b.maxLat, b.maxLng]);
    }
    for (const p of points) bounds.extend([p.lat, p.lng]);
    if (!boundary && !initial && radiusM !== null) {
      const dLat = radiusM / 111_132;
      const dLng = radiusM / (111_320 * Math.cos((center[0] * Math.PI) / 180));
      bounds.extend([center[0] - dLat, center[1] - dLng]);
      bounds.extend([center[0] + dLat, center[1] + dLng]);
    }
    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [24, 24],
        animate: !first.current,
        // A single card would otherwise fit to street level; back off so
        // the surroundings are recognisable.
        maxZoom: 16,
      });
    }
    first.current = false;
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Brings the card picked in the list into view without changing zoom. */
function PanToSelected({
  points,
  selectedId,
}: {
  points: CrewPoint[];
  selectedId: number | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (selectedId === null) return;
    const p = points.find((q) => q.id === selectedId);
    if (p) map.panTo([p.lat, p.lng], { animate: true });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
