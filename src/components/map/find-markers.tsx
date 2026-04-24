"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.markercluster";
import type { MapMarker } from "@/lib/queries/map";

/**
 * Clusters find markers via vanilla leaflet.markercluster. Wrapping through
 * `useMap` avoids depending on a third-party React cluster wrapper — those
 * tend to lag behind react-leaflet major versions.
 *
 * Anonymized finds use a distinct purple pin so it's visually obvious that
 * their position is approximate.
 */
export function FindMarkers({ markers }: { markers: readonly MapMarker[] }) {
  const map = useMap();

  useEffect(() => {
    const cluster = (L as unknown as {
      markerClusterGroup: (opts?: unknown) => L.LayerGroup;
    }).markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 60,
    });

    for (const m of markers) {
      const icon = m.isAnonymized ? anonymizedIcon : normalIcon;
      const leafMarker = L.marker([m.lat, m.lng], { icon });
      leafMarker.bindPopup(buildPopup(m));
      cluster.addLayer(leafMarker);
    }

    map.addLayer(cluster);
    return () => {
      map.removeLayer(cluster);
    };
  }, [map, markers]);

  return null;
}

const normalIcon = L.divIcon({
  className: "",
  html:
    '<div style="background:#4d9748;width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -8],
});

const anonymizedIcon = L.divIcon({
  className: "",
  html:
    '<div style="background:#a855f7;width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -8],
});

function buildPopup(m: MapMarker): string {
  const title = m.isAnonymized
    ? `Anonymizovaný nález č. ${m.id}`
    : `Nález č. ${m.id}`;
  const date = m.foundAt
    ? new Intl.DateTimeFormat("cs-CZ").format(new Date(m.foundAt))
    : "—";
  const location = m.locationName ?? (m.isAnonymized ? "—" : "bez lokality");
  // Simple HTML string; Leaflet popups don't run React. Escape everything
  // that originates in user data (location name, date already safe).
  const safeName = escapeHtml(location);
  return `
    <div style="min-width:180px">
      <strong>${escapeHtml(title)}</strong><br/>
      <span style="color:#6b7280;font-size:12px">${escapeHtml(date)}</span><br/>
      <span style="color:#6b7280;font-size:12px">${safeName}</span><br/>
      <span style="color:#4d9748;font-weight:600;font-size:12px">${m.leafCount} lístků</span><br/>
      <a href="/sbirka/${m.id}" style="color:#4d9748;font-size:13px;text-decoration:underline">Detail →</a>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
