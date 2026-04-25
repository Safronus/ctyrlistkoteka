"use client";

import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { LocationGeoPoint } from "@/lib/queries/stats";

interface Props {
  points: readonly LocationGeoPoint[];
}

/**
 * World-scale bubble map: one circle per non-anonymized location, sized
 * and tinted by the find count. We deliberately avoid a true heatmap
 * (Leaflet.heat) because the data is sparse — ~128 isolated points
 * concentrated in CZ. A heatmap layer at world zoom would render as a
 * single green smear over Moravia and convey nothing about the spread.
 *
 * Radius scales with √(count/max) so the largest bubble doesn't bury
 * everything else, and fillOpacity ramps with intensity so dense
 * clusters still read as "more activity here".
 */
export function WorldBubbleMap({ points }: Props) {
  const max = points.reduce((m, p) => Math.max(m, p.count), 0);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <MapContainer
        center={[35, 5]}
        zoom={2}
        minZoom={1}
        maxZoom={6}
        scrollWheelZoom={false}
        worldCopyJump={false}
        className="h-96 w-full"
        style={{ background: "#cfe1f5" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          noWrap
        />
        {points.map((p) => {
          const intensity = max > 0 ? p.count / max : 0;
          const radius = 5 + Math.sqrt(intensity) * 22;
          return (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lng]}
              radius={radius}
              pathOptions={{
                color: "#15803d",
                weight: 1,
                fillColor: "#22c55e",
                fillOpacity: 0.45 + intensity * 0.45,
              }}
            >
              <Tooltip direction="top" offset={[0, -4]} sticky>
                <strong>{p.name}</strong>
                <br />
                <span className="font-mono text-xs">{p.code}</span>
                <br />
                {p.count} {p.count === 1 ? "nález" : p.count >= 2 && p.count <= 4 ? "nálezy" : "nálezů"}
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
