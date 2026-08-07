/**
 * A town's outline: reading it, shrinking it, testing points against it.
 *
 * Pure geometry with no imports, because both the admin map (a client
 * component) and the scatter action (server) need it — the same split
 * that keeps `dropVocab` away from `drops`.
 *
 * The shape stored on a `DropArea` is plain GeoJSON, exactly as OSM hands
 * it over: a Polygon or a MultiPolygon, each ring an array of [lng, lat]
 * pairs, ring 0 the outline and any further rings holes. Zlín really does
 * have holes in it — enclaves belonging to neighbouring villages — and a
 * hidden card must not land inside one.
 */

export type Ring = Array<[number, number]>;

export interface PolygonGeometry {
  type: "Polygon";
  coordinates: Ring[];
}

export interface MultiPolygonGeometry {
  type: "MultiPolygon";
  coordinates: Ring[][];
}

export type BoundaryGeometry = PolygonGeometry | MultiPolygonGeometry;

/** Coerces the Json column into a geometry, or null if it is anything
 *  else. Everything downstream may then assume the shape is sound. */
export function readBoundary(raw: unknown): BoundaryGeometry | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as { type?: unknown; coordinates?: unknown };
  if (!Array.isArray(g.coordinates) || g.coordinates.length === 0) return null;
  if (g.type === "Polygon") {
    const rings = g.coordinates.filter(isRing);
    return rings.length > 0 ? { type: "Polygon", coordinates: rings } : null;
  }
  if (g.type === "MultiPolygon") {
    const polys = g.coordinates
      .filter(Array.isArray)
      .map((p) => (p as unknown[]).filter(isRing))
      .filter((p) => p.length > 0);
    return polys.length > 0
      ? { type: "MultiPolygon", coordinates: polys }
      : null;
  }
  return null;
}

function isRing(r: unknown): r is Ring {
  return (
    Array.isArray(r) &&
    r.length >= 4 &&
    r.every(
      (p) =>
        Array.isArray(p) &&
        p.length >= 2 &&
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1]),
    )
  );
}

/** Every polygon of the geometry, as ring lists. */
function polygonsOf(g: BoundaryGeometry): Ring[][] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

export interface BBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export function boundaryBBox(g: BoundaryGeometry): BBox {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const poly of polygonsOf(g)) {
    for (const [lng, lat] of poly[0]!) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  return { minLat, minLng, maxLat, maxLng };
}

/** Ray casting, holes included: a point inside a hole is outside the
 *  town. Boundary-exact cases don't matter here — this decides where to
 *  drop a marker, not who owns a parcel. */
export function pointInBoundary(
  g: BoundaryGeometry,
  lat: number,
  lng: number,
): boolean {
  for (const poly of polygonsOf(g)) {
    if (!pointInRing(poly[0]!, lat, lng)) continue;
    const inHole = poly
      .slice(1)
      .some((hole) => pointInRing(hole, lat, lng));
    if (!inHole) return true;
  }
  return false;
}

function pointInRing(ring: Ring, lat: number, lng: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const straddles = yi > lat !== yj > lat;
    if (straddles && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Total vertex count — what decides whether the shape is worth keeping
 *  as it came or worth thinning. */
export function boundaryVertexCount(g: BoundaryGeometry): number {
  let n = 0;
  for (const poly of polygonsOf(g)) for (const ring of poly) n += ring.length;
  return n;
}

/**
 * Douglas–Peucker over every ring.
 *
 * OSM hands over town outlines with thousands of vertices — Zlín's is
 * several thousand — which is a heavy JSON column, a heavy payload to the
 * admin map, and pointless precision for deciding whether a park bench is
 * in town. `tolerance` is in degrees; 0.0002° is roughly 20 m.
 */
export function simplifyBoundary(
  g: BoundaryGeometry,
  tolerance: number,
): BoundaryGeometry {
  const doRing = (ring: Ring): Ring => {
    // Keep the ring closed, and never thin it below a triangle.
    const open = ring.slice(0, -1);
    const kept = douglasPeucker(open, tolerance);
    if (kept.length < 3) return ring;
    return [...kept, kept[0]!];
  };
  if (g.type === "Polygon") {
    return { type: "Polygon", coordinates: g.coordinates.map(doRing) };
  }
  return {
    type: "MultiPolygon",
    coordinates: g.coordinates.map((poly) => poly.map(doRing)),
  };
}

function douglasPeucker(pts: Ring, tolerance: number): Ring {
  if (pts.length < 3) return pts;
  let maxDist = 0;
  let idx = 0;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDistance(pts[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      idx = i;
    }
  }
  if (maxDist <= tolerance) return [first, last];
  const left = douglasPeucker(pts.slice(0, idx + 1), tolerance);
  const right = douglasPeucker(pts.slice(idx), tolerance);
  return [...left.slice(0, -1), ...right];
}

function perpendicularDistance(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + clamped * dx), p[1] - (a[1] + clamped * dy));
}

/**
 * Random points inside the outline, by rejection sampling its bounding
 * box.
 *
 * A town fills maybe a third to a half of its own bounding box, so a
 * handful of tries per point is normal. The attempt cap exists for the
 * pathological shape — a long river valley, say — where the box is mostly
 * elsewhere; whatever is left over comes back as `short`, and the caller
 * decides (we fall back to the circle).
 */
export function scatterInBoundary(
  g: BoundaryGeometry,
  count: number,
  random: () => number = Math.random,
): { points: Array<{ lat: number; lng: number }>; short: number } {
  const box = boundaryBBox(g);
  const out: Array<{ lat: number; lng: number }> = [];
  const maxAttempts = count * 200 + 1000;
  let attempts = 0;
  while (out.length < count && attempts < maxAttempts) {
    attempts += 1;
    const lat = box.minLat + random() * (box.maxLat - box.minLat);
    const lng = box.minLng + random() * (box.maxLng - box.minLng);
    if (pointInBoundary(g, lat, lng)) out.push({ lat, lng });
  }
  return { points: out, short: count - out.length };
}
