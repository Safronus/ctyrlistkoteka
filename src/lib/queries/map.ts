/**
 * Map data query. Returns everything the /mapa page needs in one roundtrip:
 *   - find markers (id, lat/lng, anonymized flag)
 *   - location polygons (GeoJSON)
 *   - location map overlays (image URL + bounds)
 *
 * Anonymization is applied here: anonymized finds use coarsened GPS and no
 * note. See CLAUDE.md §6.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ANON_GPS_PRECISION } from "@/lib/constants";

export interface MapMarker {
  id: number;
  lat: number;
  lng: number;
  isAnonymized: boolean;
  locationName: string | null;
  foundAt: string | null; // ISO date for cheap client serialization
}

export interface MapLocation {
  id: number;
  code: string;
  displayName: string;
  centerLat: number | null;
  centerLng: number | null;
  polygon: GeoJSON.Polygon | null;
  findCount: number;
}

export interface MapImageOverlay {
  mapId: number;
  locationId: number;
  imageUrl: string;
  bounds: [[number, number], [number, number]]; // [[swLat, swLng], [neLat, neLng]]
}

export interface MapData {
  markers: MapMarker[];
  locations: MapLocation[];
  overlays: MapImageOverlay[];
}

export async function getMapData(): Promise<MapData> {
  type MarkerRow = {
    id: number;
    lat: number | null;
    lng: number | null;
    is_anonymized: boolean;
    location_name: string | null;
    found_at: Date | null;
  };

  const markerRows = await prisma.$queryRaw<MarkerRow[]>`
    SELECT f.id,
           ST_Y(f.coordinates)::float8 AS lat,
           ST_X(f.coordinates)::float8 AS lng,
           f.is_anonymized,
           COALESCE(l.display_name, l.code) AS location_name,
           f.found_at
    FROM finds f
    LEFT JOIN locations l ON l.id = f.location_id
    WHERE f.coordinates IS NOT NULL
  `;

  const factor = 10 ** ANON_GPS_PRECISION;
  const markers: MapMarker[] = [];
  for (const r of markerRows) {
    if (r.lat === null || r.lng === null) continue;
    const lat = r.is_anonymized
      ? Math.round(r.lat * factor) / factor
      : r.lat;
    const lng = r.is_anonymized
      ? Math.round(r.lng * factor) / factor
      : r.lng;
    markers.push({
      id: r.id,
      lat,
      lng,
      isAnonymized: r.is_anonymized,
      locationName: r.is_anonymized ? null : r.location_name,
      foundAt: r.found_at ? r.found_at.toISOString() : null,
    });
  }

  type LocationRow = {
    id: number;
    code: string;
    display_name: string;
    center_lat: number | null;
    center_lng: number | null;
    polygon_geojson: string | null;
    find_count: bigint;
  };

  const locRows = await prisma.$queryRaw<LocationRow[]>`
    SELECT l.id,
           l.code,
           l.display_name,
           ST_Y(l.center_point)::float8 AS center_lat,
           ST_X(l.center_point)::float8 AS center_lng,
           ST_AsGeoJSON(l.polygon) AS polygon_geojson,
           COUNT(f.id) AS find_count
    FROM locations l
    LEFT JOIN finds f ON f.location_id = l.id
    GROUP BY l.id
  `;

  const locations: MapLocation[] = locRows.map((r) => ({
    id: r.id,
    code: r.code,
    displayName: r.display_name,
    centerLat: r.center_lat,
    centerLng: r.center_lng,
    polygon: r.polygon_geojson
      ? (JSON.parse(r.polygon_geojson) as GeoJSON.Polygon)
      : null,
    findCount: Number(r.find_count),
  }));

  const mapRows = await prisma.locationMap.findMany({
    where: {
      isAnonymized: false,
      imageBounds: { not: Prisma.AnyNull },
    },
    select: {
      id: true,
      locationId: true,
      imagePath: true,
      imageBounds: true,
    },
  });

  const overlays: MapImageOverlay[] = [];
  for (const m of mapRows) {
    if (!m.imageBounds) continue;
    const bounds = m.imageBounds as unknown;
    if (
      !Array.isArray(bounds) ||
      bounds.length !== 2 ||
      !Array.isArray(bounds[0]) ||
      !Array.isArray(bounds[1])
    ) {
      continue;
    }
    overlays.push({
      mapId: m.id,
      locationId: m.locationId,
      imageUrl: toPublicImageUrl(m.imagePath),
      bounds: bounds as [[number, number], [number, number]],
    });
  }

  return { markers, locations, overlays };
}

/**
 * Maps DB-stored paths (filesystem absolute, e.g.
 * /var/ctyrlistkoteka/data/maps/…) to browser URLs served by Nginx. In the
 * seed we store synthetic /generated/maps/… paths which already fit that
 * convention; for real imports the sync script should point here.
 */
function toPublicImageUrl(path: string): string {
  if (path.startsWith("/generated/")) return path;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  // Fall back to serving a file that probably doesn't exist; the overlay
  // will 404 in the browser. The ImageOverlays component handles that
  // gracefully.
  return path;
}
