"use client";

import { useEffect, useRef } from "react";
import { CircleMarker, Popup } from "react-leaflet";
import type { CircleMarker as LeafletCircleMarker } from "leaflet";
import type { HighlightFind } from "@/lib/queries/finds";
import { formatLocationOffset } from "@/lib/format";

/**
 * Single pulsing marker rendered when /mapa receives `?find=N`. Uses two
 * stacked circles — a stable inner dot and a larger semi-transparent
 * outer ring with a CSS pulse animation — so the highlight is obvious
 * even when the bulk find layer is on. The popup auto-opens after the
 * map's fit-bounds animation settles, mirroring the location-polygon
 * popup behaviour and giving the visitor immediate context (find ID,
 * how far the GPS lies from the AOI).
 */
export function HighlightFindMarker({ find }: { find: HighlightFind }) {
  const innerRef = useRef<LeafletCircleMarker | null>(null);

  useEffect(() => {
    const layer = innerRef.current;
    if (!layer) return;
    // FitBounds animation is ~250 ms; wait one tick beyond that so the
    // popup anchors to the final marker pixel position rather than the
    // mid-zoom one.
    const t = setTimeout(() => layer.openPopup(), 350);
    return () => clearTimeout(t);
  }, [find.id]);

  return (
    <>
      {/* Outer ring — purely decorative, larger radius + lower opacity
       *  + CSS pulse via the className below. Listens for no events so
       *  clicks fall through to the inner dot. */}
      <CircleMarker
        center={[find.lat, find.lng]}
        radius={18}
        interactive={false}
        pathOptions={{
          color: "#16a34a",
          weight: 2,
          fillColor: "#22c55e",
          fillOpacity: 0.18,
          className: "ctyr-find-pulse",
        }}
      />
      <CircleMarker
        ref={innerRef}
        center={[find.lat, find.lng]}
        radius={8}
        pathOptions={{
          color: "#14532d",
          weight: 2,
          fillColor: "#16a34a",
          fillOpacity: 0.95,
        }}
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
      </CircleMarker>
    </>
  );
}
