"use client";

import { useMemo } from "react";
import { Marker, Pane, Polygon, SVGOverlay } from "react-leaflet";
import L from "leaflet";
import { FIND_DEVIATION_RADIUS_M } from "@/lib/constants";
import type { MapLocation } from "@/lib/queries/map";

/** `[lat, lng, locationId, findId, tone]` — same packed tuple the find-dots
 *  canvas consumes. tone: 0 green (≤5 m / on-location), 1 amber (deviated but
 *  inside a location-map bbox), 2 rose (deviated, outside every map). */
type FindCoord = readonly [number, number, number, number, number];

/** Andrew's monotone-chain convex hull. Returns [] for < 3 points (nothing to
 *  outline). Input/return are [lat, lng] pairs — orientation is irrelevant for
 *  a filled polygon. */
function convexHull(pts: ReadonlyArray<[number, number]>): [number, number][] {
  if (pts.length < 3) return [];
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (
    o: [number, number],
    a: [number, number],
    b: [number, number],
  ) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (order: ReadonlyArray<[number, number]>): [number, number][] => {
    const chain: [number, number][] = [];
    for (const q of order) {
      while (chain.length >= 2) {
        const a = chain[chain.length - 2];
        const b = chain[chain.length - 1];
        if (!a || !b || cross(a, b, q) > 0) break;
        chain.pop();
      }
      chain.push(q);
    }
    chain.pop(); // drop the last point — it's the first of the other chain
    return chain;
  };
  const lower = build(p);
  const upper = build([...p].reverse());
  return lower.concat(upper);
}

// Pulsing rose-outlier marker. A plain divIcon with one span the CSS animates;
// white ring so it reads over anything. Static + always mounted (icons are
// cheap to reuse). Anchored at centre.
const ROSE_PULSE_ICON = L.divIcon({
  className: "ctyr-rose-pulse-wrap",
  html: '<span class="ctyr-rose-pulse"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

/**
 * Decorations for the currently-selected POLYGON-LESS location, so a place
 * that's only a centre point stays legible under a dense find cluster:
 *   • green radial-gradient circle at the 5 m deviation radius (under the
 *     finds) — the boundary where on-location (green) tips over to deviated;
 *   • a faint amber convex hull of the amber (in-map-bbox) deviated finds;
 *   • the far rose outliers gently pulse (above the finds) — no hull for them,
 *     which would balloon since they're far from the centre by definition.
 * Polygon locations render their real outline, so this is skipped for them.
 */
export function SelectedLocationDecor({
  location,
  findCoords,
}: {
  location: MapLocation | null;
  findCoords: ReadonlyArray<FindCoord>;
}) {
  const active =
    location &&
    location.polygon === null &&
    location.centerLat !== null &&
    location.centerLng !== null
      ? location
      : null;

  const { amberHull, rose } = useMemo(() => {
    if (!active) return { amberHull: [] as [number, number][], rose: [] };
    const amber: [number, number][] = [];
    const roseFinds: [number, number][] = [];
    for (const c of findCoords) {
      if (c[2] !== active.id) continue;
      if (c[4] === 1) amber.push([c[0], c[1]]);
      else if (c[4] === 2) roseFinds.push([c[0], c[1]]);
    }
    return { amberHull: convexHull(amber), rose: roseFinds };
  }, [active, findCoords]);

  if (!active) return null;
  const lat = active.centerLat as number;
  const lng = active.centerLng as number;
  // Square geographic bbox 2×radius across, centred on the point — the SVG
  // circle inscribed in it is exactly the 5 m radius and scales with zoom.
  const circleBounds = L.latLng(lat, lng).toBounds(2 * FIND_DEVIATION_RADIUS_M);

  return (
    <>
      {/* z-index 450: BELOW the find-dots canvas (550) so the circle + hull
          sit UNDER the clover icons, as a soft backdrop. */}
      <Pane name="loc-decor-under" style={{ zIndex: 450 }}>
        <SVGOverlay
          bounds={circleBounds}
          pane="loc-decor-under"
          attributes={{ viewBox: "0 0 100 100", preserveAspectRatio: "none" }}
          interactive={false}
        >
          <defs>
            <radialGradient id="loc-decor-grad">
              <stop offset="0%" stopColor="#16a34a" stopOpacity="0.5" />
              <stop offset="60%" stopColor="#16a34a" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#16a34a" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="50" fill="url(#loc-decor-grad)" />
        </SVGOverlay>
        {amberHull.length >= 3 && (
          <Polygon
            positions={amberHull}
            interactive={false}
            pane="loc-decor-under"
            pathOptions={{
              color: "#d97706",
              weight: 1,
              opacity: 0.35,
              fillColor: "#f59e0b",
              fillOpacity: 0.06,
            }}
          />
        )}
      </Pane>
      {/* Rose outliers pulse ABOVE the finds (default markerPane, 600).
          One divIcon per outlier — there are usually only a handful. */}
      {rose.map(([rlat, rlng], i) => (
        <Marker
          key={`${active.id}-rose-${i}`}
          position={[rlat, rlng]}
          icon={ROSE_PULSE_ICON}
          interactive={false}
          keyboard={false}
        />
      ))}
    </>
  );
}
