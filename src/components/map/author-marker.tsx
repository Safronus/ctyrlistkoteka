"use client";

import { useMemo } from "react";
import { Marker } from "react-leaflet";
import L from "leaflet";
import { AUTHOR_LOCATION_ID } from "@/lib/constants";
import type { MapLocation } from "@/lib/queries/map";

/**
 * Draws the author's Safronus logo (the smiley + wordmark — both baked
 * into /safronus.png) at the centre point of the home location
 * (AUTHOR_LOCATION_ID, map 00158) — a small personal touch. That
 * location HAS a polygon, so LocationDots deliberately skips its centre
 * dot; this layer fills the gap with the logo instead of the generic
 * blue dot every other polygon-less spot gets.
 *
 * Just the transparent PNG, no backdrop and no extra text — the
 * wordmark is already in the image. Sized at ~2× a polygon-less
 * location dot (those render at radius 6 → 12 px), anchored at its
 * centre so it sits exactly on the GPS point. Non-interactive on
 * purpose: clicks fall straight through to the polygon underneath, so
 * selecting the location still works as if the marker weren't there.
 */
const ICON_PX = 24;

export function AuthorMarker({
  locations,
}: {
  locations: readonly MapLocation[];
}) {
  const loc = locations.find((l) => l.id === AUTHOR_LOCATION_ID);

  const icon = useMemo(
    () =>
      L.icon({
        iconUrl: "/safronus.png",
        iconSize: [ICON_PX, ICON_PX],
        iconAnchor: [ICON_PX / 2, ICON_PX / 2],
        className: "ctyr-author-marker",
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
