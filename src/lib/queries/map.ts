/**
 * Map data query. Returns everything the /mapa page needs in one roundtrip:
 *   - location polygons (GeoJSON)
 *   - location map overlays (image URL + bounds)
 *
 * Anonymization is applied here per CLAUDE.md §6 — anonymized locations
 * are dropped from polygons and overlays so the public payload can't
 * leak a hidden spot via shape or imagery.
 *
 * Find markers used to live here too; the page intentionally hides
 * individual finds now (only locations matter), so the markers query
 * was removed.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

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
  locations: MapLocation[];
  overlays: MapImageOverlay[];
}

export async function getMapData(): Promise<MapData> {
  // A location is anonymized if at least one of its maps carries the
  // is_anonymized flag (matching /lokality logic). Everything keyed off
  // such a location — polygons, overlays — must be omitted from the
  // public payload entirely.
  const anonLocRows = await prisma.locationMap.findMany({
    where: { isAnonymized: true },
    select: { locationId: true },
    distinct: ["locationId"],
  });
  const anonLocIds = new Set(anonLocRows.map((r) => r.locationId));

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

  const locations: MapLocation[] = locRows
    .filter((r) => !anonLocIds.has(r.id))
    .map((r) => ({
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

  return { locations, overlays };
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
