"use client";

import { useMemo } from "react";
import { Marker } from "react-leaflet";
import L from "leaflet";
import { AUTHOR_LOCATION_ID } from "@/lib/constants";
import type { MapLocation } from "@/lib/queries/map";

/**
 * Draws the author's footer logo (the Safronus smiley + caption) at the
 * centre point of the home location (AUTHOR_LOCATION_ID, map 00158) — a
 * small personal touch. That location HAS a polygon, so LocationDots
 * deliberately skips its centre dot; this layer fills the gap with the
 * logo instead of the generic blue dot every other polygon-less spot
 * gets.
 *
 * Non-interactive on purpose: clicks fall straight through to the
 * polygon underneath, so selecting the location still works exactly as
 * if the marker weren't there. The badge centres on the point via the
 * classic 0×0 divIcon + translate(-50%,-50%) trick, which keeps it
 * anchored regardless of the caption's rendered width.
 */
export function AuthorMarker({
  locations,
}: {
  locations: readonly MapLocation[];
}) {
  const loc = locations.find((l) => l.id === AUTHOR_LOCATION_ID);

  const icon = useMemo(
    () =>
      L.divIcon({
        className: "ctyr-author-marker",
        iconSize: [0, 0],
        html: `
          <span style="
            position:absolute;
            transform:translate(-50%,-50%);
            display:inline-flex;
            align-items:center;
            gap:3px;
            padding:2px 6px 2px 3px;
            border-radius:9999px;
            background:rgba(255,255,255,0.9);
            box-shadow:0 1px 3px rgba(0,0,0,0.35);
            white-space:nowrap;
            font:600 9px/1 system-ui,-apple-system,'Segoe UI',sans-serif;
            color:#374151;
          ">
            <img src="/safronus.png" alt="" width="16" height="16" style="display:block" />
            Safronus
          </span>
        `,
      }),
    [],
  );

  if (!loc || loc.centerLat === null || loc.centerLng === null) return null;

  return (
    <Marker
      position={[loc.centerLat, loc.centerLng]}
      icon={icon}
      interactive={false}
      keyboard={false}
      // Sit above the polygon fill but below interactive popups.
      zIndexOffset={500}
    />
  );
}
