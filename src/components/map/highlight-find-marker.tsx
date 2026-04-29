"use client";

import { useEffect, useMemo, useRef } from "react";
import { Marker, Popup } from "react-leaflet";
import L, { type Marker as LeafletMarker } from "leaflet";
import type { HighlightFind } from "@/lib/queries/finds";
import { formatLocationOffset } from "@/lib/format";

/**
 * Single clover-shaped marker rendered when /mapa receives `?find=N`. The
 * shape mirrors the canvas sprite painted for every other find dot, just
 * scaled up and dressed up: the same four overlapping circles + darker
 * core, plus a white halo and a pulsing ring so the visitor's eye lands
 * on this one point even with the bulk Nálezy layer toggled back on.
 *
 * Built as a Leaflet divIcon (HTML+SVG) rather than a CircleMarker so the
 * thematic shape matches the rest of the map and the pulse can ride on
 * a CSS animation instead of an SVG attribute keyframe (cheaper, plays
 * nicer with `prefers-reduced-motion`).
 *
 * The popup auto-opens after the fitBounds animation settles, mirroring
 * the location-polygon popup behaviour on /mapa.
 */
const HIGHLIGHT_BOX = 44;

export function HighlightFindMarker({ find }: { find: HighlightFind }) {
  const markerRef = useRef<LeafletMarker | null>(null);

  // Icon HTML is captured once per find — a fresh icon would force
  // Leaflet to re-render the DOM on every re-render of MapView.
  const icon = useMemo(
    () =>
      L.divIcon({
        className: "ctyr-find-highlight",
        html: HIGHLIGHT_HTML,
        iconSize: [HIGHLIGHT_BOX, HIGHLIGHT_BOX],
        iconAnchor: [HIGHLIGHT_BOX / 2, HIGHLIGHT_BOX / 2],
        popupAnchor: [0, -HIGHLIGHT_BOX / 2 + 4],
      }),
    [],
  );

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    // FitBounds animates ~250 ms; wait one tick beyond that so the
    // popup anchors to the final marker pixel position rather than the
    // mid-zoom one.
    const t = setTimeout(() => marker.openPopup(), 350);
    return () => clearTimeout(t);
  }, [find.id]);

  return (
    <Marker
      ref={markerRef}
      position={[find.lat, find.lng]}
      icon={icon}
      keyboard={false}
    >
      <Popup>
        <div>
          <strong>Nález #{find.id}</strong>
          {find.offset && (
            <div style={{ color: "#4b5563", fontSize: 12 }}>
              {formatLocationOffset(find.offset)}
            </div>
          )}
        </div>
      </Popup>
    </Marker>
  );
}

// Static HTML — same four-leaf clover as the canvas sprite + the pin
// SVG on the find detail page, just scaled to HIGHLIGHT_BOX. Wrapped
// twice: an outer pulse ring (CSS keyframes) and an inner SVG with a
// white halo backdrop so the green stays legible over OSM tiles.
const HIGHLIGHT_HTML = `
  <span class="ctyr-find-highlight__pulse" aria-hidden="true"></span>
  <svg
    viewBox="0 0 32 32"
    width="32"
    height="32"
    class="ctyr-find-highlight__clover"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="16" cy="16" r="14" fill="#ffffff" />
    <g fill="#15803d">
      <circle cx="16" cy="11" r="5" />
      <circle cx="11" cy="16" r="5" />
      <circle cx="21" cy="16" r="5" />
      <circle cx="16" cy="21" r="5" />
      <circle cx="16" cy="16" r="3" fill="#0f6e34" />
    </g>
  </svg>
`;
