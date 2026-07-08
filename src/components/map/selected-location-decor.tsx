"use client";

import { useMemo } from "react";
import { Marker, Pane, SVGOverlay } from "react-leaflet";
import L from "leaflet";
import { FIND_DEVIATION_RADIUS_M } from "@/lib/constants";
import { cloverSpriteDataUrl } from "./find-dots-canvas";
import type { MapLocation } from "@/lib/queries/map";

/** `[lat, lng, locationId, findId, tone]` — same packed tuple the find-dots
 *  canvas consumes. tone: 0 green (≤5 m / on-location), 1 amber (deviated but
 *  inside a location-map bbox), 2 rose (deviated, outside every map). */
type FindCoord = readonly [number, number, number, number, number];

/** Icon box (CSS px) for a pulsing clover — a touch bigger than a map dot so
 *  the pulse reads clearly. */
const PULSE_BOX = 24;

/**
 * Decorations for the currently-selected POLYGON-LESS location, so a place
 * that's only a centre point stays legible under a dense find cluster:
 *   • a green radial-gradient circle at the 5 m deviation radius (under the
 *     finds) — the boundary where on-location (green, ≤5 m) tips over to
 *     deviated; it "hugs" the tight on-location cluster;
 *   • the location's finds gently PULSE (clover icons matching the canvas
 *     dots) as a highlight. Which tiers pulse is visitor-toggleable: the
 *     deviated (amber+rose) outliers by default — they're the scattered ones
 *     that need attributing — and optionally the on-location (green) ones too.
 * Polygon locations render their real outline, so this is skipped for them.
 */
export function SelectedLocationDecor({
  location,
  findCoords,
  pulseDeviated,
  pulseOnLocation,
}: {
  location: MapLocation | null;
  findCoords: ReadonlyArray<FindCoord>;
  /** Pulse the deviated finds (amber+rose, tone ≥ 1). */
  pulseDeviated: boolean;
  /** Also pulse the on-location finds (green, ≤5 m, tone 0) — they already
   *  sit inside the circle, so this is mostly a look/testing aid. */
  pulseOnLocation: boolean;
}) {
  const active =
    location &&
    location.polygon === null &&
    location.centerLat !== null &&
    location.centerLng !== null
      ? location
      : null;

  // One divIcon per tone; the clover img matches the canvas find dots exactly
  // (same sprite). Client-only (the sprite is canvas-rendered).
  const icons = useMemo(() => {
    if (typeof window === "undefined") return null;
    const make = (tone: number) =>
      L.divIcon({
        className: "",
        html: `<img class="ctyr-find-pulse" alt="" width="${PULSE_BOX}" height="${PULSE_BOX}" src="${cloverSpriteDataUrl(tone, PULSE_BOX)}" />`,
        iconSize: [PULSE_BOX, PULSE_BOX],
        iconAnchor: [PULSE_BOX / 2, PULSE_BOX / 2],
      });
    return [make(0), make(1), make(2)] as const;
  }, []);

  const pulsing = useMemo(() => {
    if (!active) return [];
    const out: Array<{ lat: number; lng: number; tone: number }> = [];
    for (const c of findCoords) {
      if (c[2] !== active.id) continue;
      const tone = c[4];
      if ((tone === 0 && pulseOnLocation) || (tone >= 1 && pulseDeviated)) {
        out.push({ lat: c[0], lng: c[1], tone });
      }
    }
    return out;
  }, [active, findCoords, pulseDeviated, pulseOnLocation]);

  if (!active) return null;
  const lat = active.centerLat as number;
  const lng = active.centerLng as number;
  // Square geographic bbox 2×radius across, centred on the point — the SVG
  // circle inscribed in it is exactly the 5 m radius and scales with zoom.
  const circleBounds = L.latLng(lat, lng).toBounds(2 * FIND_DEVIATION_RADIUS_M);

  return (
    <>
      {/* z-index 450: BELOW the find-dots canvas (550) so the circle is a soft
          backdrop under the clover icons. */}
      <Pane name="loc-decor-under" style={{ zIndex: 450 }}>
        <SVGOverlay
          bounds={circleBounds}
          pane="loc-decor-under"
          attributes={{ viewBox: "0 0 100 100", preserveAspectRatio: "none" }}
          interactive={false}
        >
          <defs>
            <radialGradient id="loc-decor-grad">
              <stop offset="0%" stopColor="#16a34a" stopOpacity="0.5" />
              <stop offset="60%" stopColor="#16a34a" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#16a34a" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="50" fill="url(#loc-decor-grad)" />
        </SVGOverlay>
      </Pane>
      {/* Pulsing finds ride the default markerPane (600), above the finds. */}
      {icons &&
        pulsing.map((f, i) => (
          <Marker
            key={`${active.id}-pulse-${i}`}
            position={[f.lat, f.lng]}
            icon={icons[f.tone] ?? icons[0]}
            interactive={false}
            keyboard={false}
          />
        ))}
    </>
  );
}
