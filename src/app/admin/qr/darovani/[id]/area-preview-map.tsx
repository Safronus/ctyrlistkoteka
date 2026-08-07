"use client";

import { useEffect, useRef } from "react";
import {
  Circle,
  CircleMarker,
  GeoJSON,
  MapContainer,
  TileLayer,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { boundaryBBox, type BoundaryGeometry } from "@/lib/admin/dropBoundary";

/**
 * What an area actually covers: its centre, the scatter radius and — once
 * pulled from OSM — the town's real outline.
 *
 * Sits right under the area's form so the numbers being typed have a
 * picture. A radius in metres means nothing until you watch it swallow
 * half a valley, and "Zlín" means nothing until the shape shows you it
 * reaches Malenovice.
 *
 * Read-only on purpose: placing cards belongs to the big map below, which
 * has the selection machinery for it.
 */
export function AreaPreviewMap({
  lat,
  lng,
  zoom,
  radiusM,
  boundary,
}: {
  lat: number;
  lng: number;
  zoom: number;
  radiusM: number | null;
  boundary: BoundaryGeometry | null;
}) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={zoom}
      scrollWheelZoom={false}
      className="h-64 w-full rounded-lg"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {boundary && (
        <GeoJSON
          // react-leaflet's GeoJSON does not diff `data`; remounting on a
          // new shape is the supported way to redraw it.
          key={boundaryKey(boundary)}
          data={boundary as never}
          style={{
            color: "#0f766e",
            weight: 2,
            fillColor: "#14b8a6",
            fillOpacity: 0.12,
          }}
        />
      )}
      {radiusM !== null && (
        <Circle
          center={[lat, lng]}
          radius={radiusM}
          pathOptions={{
            color: "#16a34a",
            weight: 1.5,
            dashArray: "6 6",
            fillOpacity: 0.04,
          }}
        />
      )}
      <CircleMarker
        center={[lat, lng]}
        radius={6}
        pathOptions={{
          color: "#ffffff",
          weight: 2,
          fillColor: "#16a34a",
          fillOpacity: 1,
        }}
      />
      <FollowForm lat={lat} lng={lng} zoom={zoom} boundary={boundary} />
    </MapContainer>
  );
}

function boundaryKey(b: BoundaryGeometry): string {
  const box = boundaryBBox(b);
  return `${box.minLat},${box.minLng},${box.maxLat},${box.maxLng}`;
}

/**
 * Keeps the view honest while the form is edited.
 *
 * A newly fetched outline is framed once, so pulling "Zlín" immediately
 * shows the whole town. After that the centre and zoom fields are back in
 * charge — otherwise every keystroke would yank the map away from
 * wherever the operator had just panned.
 */
function FollowForm({
  lat,
  lng,
  zoom,
  boundary,
}: {
  lat: number;
  lng: number;
  zoom: number;
  boundary: BoundaryGeometry | null;
}) {
  const map = useMap();
  const framed = useRef<string | null>(null);

  useEffect(() => {
    const key = boundary ? boundaryKey(boundary) : null;
    if (key && key !== framed.current) {
      framed.current = key;
      const box = boundaryBBox(boundary!);
      map.fitBounds(
        [
          [box.minLat, box.minLng],
          [box.maxLat, box.maxLng],
        ],
        { padding: [16, 16] },
      );
      return;
    }
    map.setView([lat, lng], zoom);
  }, [map, lat, lng, zoom, boundary]);

  return null;
}
