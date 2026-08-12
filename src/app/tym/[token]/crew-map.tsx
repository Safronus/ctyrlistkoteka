"use client";

import { useCallback, useEffect, useRef } from "react";
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

export interface CrewPoint {
  id: number;
  findId: number;
  status: DropStatus;
  lat: number;
  lng: number;
  placedBy: string | null;
  teamNote: string;
  /** Colour of the crew member responsible, or null when nobody is. */
  crewColor?: string | null;
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
  onPick,
  picked,
  focus,
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
  /** A tap on empty map reads out that spot's coordinates. Nothing is
   *  written anywhere — it is a ruler, not a pen. */
  onPick: (lat: number, lng: number) => void;
  /** The spot last read out, so it stays marked while being copied. */
  picked: { lat: number; lng: number } | null;
  /** Ask the map to fly to one card; the token makes a repeat click work. */
  focus: { id: number; token: number } | null;
}) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom
      // Fills whatever the layout gives it: half the screen on a phone,
      // the whole left column on a desktop.
      className="h-full w-full"
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
      <ClickToRead onPick={onPick} />
      <FlyToCard points={points} focus={focus} />

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

      {picked && (
        <Marker
          position={[picked.lat, picked.lng]}
          icon={crosshairIcon()}
          interactive={false}
        />
      )}

      {points.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={dropCloverIcon(DROP_STATUS_COLOR[p.status], p.id === selectedId, {
            ring: p.crewColor,
          })}
          eventHandlers={{
            click: (e) => {
              // Selecting a card must not also read out the coordinates
              // under it — stop the click before the map handler sees it.
              e.originalEvent.stopPropagation();
              onSelect(p.id);
            },
          }}
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

/**
 * Frames the town outline, the scatter circle and every card — and keeps
 * Leaflet honest about how big its container is.
 *
 * Both jobs belong together because they fail together. This map is sized
 * by the page's flex layout, not by a fixed height, so it can mount into a
 * box that is still zero pixels tall: Leaflet then caches those dimensions,
 * fits to nothing, and paints one lonely tile in a corner forever. The
 * ResizeObserver tells it the truth, and the first time the box has a real
 * size the view is fitted again — which is also what makes a phone rotating
 * or a window resizing behave.
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
  points: CrewPoint[];
}) {
  const map = useMap();
  const first = useRef(true);
  const everSized = useRef(false);

  const fit = useCallback(
    (initial: boolean) => {
      // On the first pass the CARDS decide the view and the town outline
      // is ignored: an OSM boundary can be the whole district, and fitting
      // it drops eleven markers into a thumbnail in the middle of nowhere.
      // The "celá oblast" button then does include it — that is what it is
      // for.
      const cardsOnly = initial && points.length > 0;
      const bounds = L.latLngBounds([]);
      if (boundary && !cardsOnly) {
        const b = boundaryBBox(boundary);
        bounds.extend([b.minLat, b.minLng]);
        bounds.extend([b.maxLat, b.maxLng]);
      }
      for (const p of points) bounds.extend([p.lat, p.lng]);
      if (!boundary && !cardsOnly && radiusM !== null) {
        const dLat = radiusM / 111_132;
        const dLng =
          radiusM / (111_320 * Math.cos((center[0] * Math.PI) / 180));
        bounds.extend([center[0] - dLat, center[1] - dLng]);
        bounds.extend([center[0] + dLat, center[1] + dLng]);
      }
      if (!bounds.isValid()) return;
      map.fitBounds(bounds, {
        padding: [24, 24],
        animate: !initial,
        // A single card would otherwise fit to street level; back off so
        // the surroundings are recognisable.
        maxZoom: 16,
      });
    },
    // `points` is rebuilt on every filter change; that is fine, the
    // callback is only CALLED from the two effects below.
    [map, boundary, center, radiusM, points],
  );

  // The "celá oblast" button, and the first mount.
  useEffect(() => {
    fit(first.current);
    first.current = false;
    // Deliberately only on the token: refitting whenever a card is
    // filtered out would drag the map out from under whoever is reading it.
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      if (!everSized.current && el.clientWidth > 0 && el.clientHeight > 0) {
        everSized.current = true;
        fit(true);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [map, fit]);

  return null;
}

/**
 * Reads out the coordinates of wherever the map is tapped.
 *
 * The crew fills the shared spreadsheet by hand, and "what are the
 * coordinates of that bench" is otherwise a trip through a third-party map
 * app. Strictly one-way: this page never writes anything back.
 */
function ClickToRead({
  onPick,
}: {
  onPick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** The spot being read out. Deliberately unlike a card's clover — this is
 *  a measurement, not a hiding place. */
let crosshair: L.DivIcon | null = null;
function crosshairIcon(): L.DivIcon {
  crosshair ??= L.divIcon({
    className: "",
    html: `
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false">
        <circle cx="16" cy="16" r="9" fill="none" stroke="#ffffff" stroke-width="4" />
        <circle cx="16" cy="16" r="9" fill="none" stroke="#7c3aed" stroke-width="2" />
        <path d="M16 1v8M16 23v8M1 16h8M23 16h8" stroke="#ffffff" stroke-width="4" stroke-linecap="round" />
        <path d="M16 1v8M16 23v8M1 16h8M23 16h8" stroke="#7c3aed" stroke-width="2" stroke-linecap="round" />
        <circle cx="16" cy="16" r="1.5" fill="#7c3aed" />
      </svg>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
  return crosshair;
}

/**
 * Whether a map move should skip its animation.
 *
 * Two honest reasons, not a workaround: somebody who asked for reduced
 * motion should not be flown across a town, and an animation in a hidden
 * tab never runs at all — requestAnimationFrame is frozen there, so an
 * animated move would silently never arrive. Leaflet turns `animate:
 * false` into a plain setView, which lands either way.
 */
function prefersInstant(): boolean {
  if (typeof document !== "undefined" && document.hidden) return true;
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * Flies to one card when the list asks.
 *
 * Zooms IN rather than just panning — the list's "na mapě" is asked when a
 * pin is somewhere off screen or lost in a cluster of others, and a pan at
 * town zoom answers neither. Never zooms out: if the reader is already
 * closer than street level, that is where they wanted to be.
 */
function FlyToCard({
  points,
  focus,
}: {
  points: CrewPoint[];
  focus: { id: number; token: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!focus) return;
    const p = points.find((q) => q.id === focus.id);
    if (p) {
      map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 17), {
        animate: !prefersInstant(),
      });
    }
    // On the token, not the id: asking for the same card twice (after
    // panning away) has to work.
  }, [focus?.token]); // eslint-disable-line react-hooks/exhaustive-deps
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
    if (p) map.panTo([p.lat, p.lng], { animate: !prefersInstant() });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
