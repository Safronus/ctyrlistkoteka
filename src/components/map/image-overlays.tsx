"use client";

import { ImageOverlay } from "react-leaflet";
import type { MapImageOverlay } from "@/lib/queries/map";

/**
 * Semi-transparent PNG overlays from the per-location map screenshots. If
 * the file 404s in the browser the overlay just doesn't render — Leaflet
 * doesn't throw.
 */
export function ImageOverlays({
  overlays,
}: {
  overlays: readonly MapImageOverlay[];
}) {
  return (
    <>
      {overlays.map((o) => (
        <ImageOverlay
          key={o.mapId}
          url={o.imageUrl}
          bounds={o.bounds}
          opacity={0.55}
        />
      ))}
    </>
  );
}
