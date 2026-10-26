/**
 * Server-rendered continent maps for the /statistiky geo tabs.
 *
 * The world tab stays inline in the page (coarse 110m data is plenty at
 * world scale). The continent tabs zoom in, where 110m looks crude, so they
 * draw the 50m dataset — and to keep that weight out of the page HTML they
 * are fetched on demand from `/api/stats/continent-map/<continent>`, which
 * calls `renderContinentMapSvg` here. The output is an SVG *string* (not a
 * React tree) because it is injected into the already-hydrated tab.
 *
 * Three things make the map read as "this continent":
 *   - members get the find colouring; every other country is flat, inert
 *     land (no colour, no tooltip), so neighbours at the edge recede;
 *   - one outline traces the continent, built from the TopoJSON mesh: only
 *     arcs with a member on exactly one side (or a member's coast) — so
 *     internal borders never thicken into the outline;
 *   - Russia, Kazakhstan, Turkey, Georgia and Azerbaijan are cut along the
 *     conventional Europe–Asia line (Ural → Ural river → Caspian → Caucasus
 *     crest → Bosporus/Dardanelles), by SVG clip paths at draw time. The
 *     data is untouched — a country's find count is still per country.
 *
 * Everything geometric (projection, paths, mesh, clip shapes) depends only
 * on the static dataset, so it is computed once per continent and cached in
 * memory; a request only assembles fills and tooltips around it.
 */

import { createHash } from "node:crypto";
import { geoEqualEarth, geoPath, type GeoProjection, type GeoStream } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { Feature, Geometry } from "geojson";
import type { GeometryCollection, GeometryObject, Topology } from "topojson-specification";
// world-atlas ships JSON only; resolveJsonModule handles the import. The
// same 50m file `world-countries-hires.ts` loads for GPS → country, so ids
// match `byCountry` exactly.
import topologyData from "world-atlas/countries-50m.json";
import {
  CONTINENT_FRAME,
  isContinentMember,
  isTranscontinental,
  type ContinentFrame,
  type ContinentKey,
} from "@/lib/continents";

/**
 * The Europe–Asia line, north to south: through the Kara Sea east of Novaya
 * Zemlya, along the Ural crest, down the Ural river to the Caspian, across
 * the sea to the Greater Caucasus watershed, along the crest to the Black
 * Sea, then through the Bosporus, the Sea of Marmara and the Dardanelles
 * into the Aegean. Approximate (it only ever cuts the five transcontinental
 * countries, never a neighbour), but close enough that what's drawn matches
 * the textbook split. [lng, lat].
 */
const EUROPE_ASIA_LINE: ReadonlyArray<[number, number]> = [
  [70.5, 86], [70.5, 77.2], [66, 74], [65, 72], [65.5, 70], [66.4, 68.9],
  // Ural crest
  [65.2, 67.6], [64.9, 66.7], [63, 66], [61.5, 65.6], [60.1, 65], [59.3, 63.9],
  [59.3, 62], [59.6, 59.6], [59.6, 58], [60, 57], [59.8, 56.4], [59.3, 55.4],
  [59.4, 54.3],
  // Ural river
  [59.05, 53.4], [58.9, 52.3], [58.55, 51.2], [57, 51.4], [55.1, 51.75],
  [53.5, 51.5], [52.3, 51.3], [51.37, 51.23], [51.3, 50.4], [51.5, 49.5],
  [51.75, 48.55], [51.85, 47.6], [51.9, 47.1], [51.8, 46.85],
  // Caspian, then the Greater Caucasus crest
  [51.5, 46], [50.3, 43.5], [49.6, 41.7], [49.1, 41.08], [48.4, 41.3],
  [47.8, 41.2], [46.8, 41.7], [45.9, 42.2], [45.2, 42.55], [44.5, 42.7],
  [43.6, 42.85], [42.7, 43.1], [41.6, 43.4], [40.5, 43.55], [39.6, 43.9],
  [38.7, 44.2], [37.8, 44.6], [37.3, 44.95], [37, 44.9],
  // Black Sea → Bosporus → Marmara → Dardanelles → Aegean
  [29.2, 41.35], [29.05, 41.05], [28.97, 40.98], [28, 40.7], [26.7, 40.42],
  [26.4, 40.2], [26.18, 40.04], [25.9, 39.9], [25, 39], [25, 30],
];

/** Closed ring of everything on the EUROPE side of the line. Exported for
 *  the test that pins which side known cities fall on. */
export const EUROPE_SIDE_RING: ReadonlyArray<[number, number]> = [
  [-45, 86],
  ...EUROPE_ASIA_LINE,
  [-45, 30],
];

type Role = "pure" | "trans" | "none";

interface CountryShape {
  key: string;
  id: string;
  name: string;
  d: string;
  role: Role;
}

interface ContinentGeometry {
  width: number;
  height: number;
  countries: CountryShape[];
  /** Outline arcs owned by a whole (non-split) member. */
  outlinePure: string;
  /** Outline arcs owned by a transcontinental member — drawn inside the
   *  side clip so only its own-continent part shows. */
  outlineTrans: string;
  /** Europe/Asia only: the side clip and the dividing line. */
  side: { clip: string; evenodd: boolean; line: string } | null;
}

/** Drop projected points closer than `tol` (viewBox units) to the last
 *  kept one. At this zoom 50m data carries far more vertices than a screen
 *  can show; this keeps its accuracy where it's visible (coasts, small
 *  countries) at a fraction of the bytes. The last point of every line is
 *  always emitted so rings still close where they should. */
function decimate(projection: GeoProjection, tol: number) {
  return {
    stream(out: GeoStream): GeoStream {
      let lx = 0;
      let ly = 0;
      let has = false;
      let px = 0;
      let py = 0;
      let pending = false;
      const sink: GeoStream = {
        point(x, y) {
          if (!has || Math.hypot(x - lx, y - ly) >= tol) {
            out.point(x, y);
            lx = x;
            ly = y;
            has = true;
            pending = false;
          } else {
            px = x;
            py = y;
            pending = true;
          }
        },
        lineStart() {
          has = false;
          pending = false;
          out.lineStart();
        },
        lineEnd() {
          if (pending) out.point(px, py);
          out.lineEnd();
        },
        polygonStart() {
          out.polygonStart();
        },
        polygonEnd() {
          out.polygonEnd();
        },
        sphere() {
          out.sphere?.();
        },
      };
      return projection.stream(sink);
    },
  };
}

/** Sample points along a frame's edges (MultiPoint, not Polygon: d3-geo
 *  reads a lat/lng rectangle ring by its winding and, wound the wrong way,
 *  takes it as the whole globe *minus* the rectangle — fitSize would zoom
 *  back out to the world). */
function frameFit([[w, s], [e, n]]: ContinentFrame["bounds"]): Feature {
  const STEPS = 24;
  const pts: [number, number][] = [];
  for (let i = 0; i <= STEPS; i++) {
    const lng = w + ((e - w) * i) / STEPS;
    pts.push([lng, s], [lng, n]);
  }
  for (let i = 0; i <= STEPS; i++) {
    const lat = s + ((n - s) * i) / STEPS;
    pts.push([w, lat], [e, lat]);
  }
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "MultiPoint", coordinates: pts },
  };
}

/** A lng/lat polyline projected to a planar SVG path, densified so the
 *  projection's curvature is followed. Planar on purpose — no spherical
 *  winding to get wrong for the clip ring. */
function planarPath(
  projection: GeoProjection,
  pts: ReadonlyArray<[number, number]>,
  close: boolean,
): string {
  const out: string[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1] ?? (close ? pts[0]! : null);
    const steps = b ? Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))) : 1;
    for (let k = 0; k < (b ? steps : 1); k++) {
      const t = k / steps;
      const lng = b ? a[0] + (b[0] - a[0]) * t : a[0];
      const lat = b ? a[1] + (b[1] - a[1]) * t : a[1];
      const p = projection([lng, lat]);
      if (!p) continue;
      out.push(`${out.length === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`);
    }
  }
  return out.join("") + (close ? "Z" : "");
}

const geometryCache = new Map<ContinentKey, ContinentGeometry>();

function geometryProps(g: GeometryObject): { id: string; name: string } {
  return {
    id: String((g as { id?: string | number }).id ?? ""),
    name: (g.properties as { name?: string } | undefined)?.name ?? "",
  };
}

function getContinentGeometry(continent: ContinentKey): ContinentGeometry {
  const hit = geometryCache.get(continent);
  if (hit) return hit;

  const frame = CONTINENT_FRAME[continent];
  const { width, height } = frame;
  const centre = (frame.bounds[0][0] + frame.bounds[1][0]) / 2;
  // Centring the projection on the continent's own meridian keeps its
  // shapes upright — the world map's prime-meridian centre shears East
  // Asia and the Americas.
  const projection = geoEqualEarth()
    .rotate([-centre, 0])
    .fitSize([width, height], frameFit(frame.bounds))
    .clipExtent([[0, 0], [width, height]]);
  const path = geoPath(decimate(projection, 1.1)).digits(1);

  const split = continent === "europe" || continent === "asia";
  const roleOf = (id: string, name: string): Role =>
    !isContinentMember(continent, id, name)
      ? "none"
      : split && isTranscontinental(id)
        ? "trans"
        : "pure";

  const topo = topologyData as unknown as Topology;
  const gc = topo.objects.countries as GeometryCollection;

  const countries: CountryShape[] = [];
  for (const g of gc.geometries) {
    const { id, name } = geometryProps(g);
    const f = feature(topo, g) as Feature<Geometry>;
    const d = path(f);
    if (!d) continue; // entirely outside the window
    countries.push({ key: `${id}|${name}`, id, name, d, role: roleOf(id, name) });
  }

  const roles = new Map<GeometryObject, Role>();
  for (const g of gc.geometries) {
    const { id, name } = geometryProps(g);
    roles.set(g, roleOf(id, name));
  }
  // An outline arc has a member on exactly one side; a coast (a === b) is
  // an outline arc when its country is a member. The owner (that member)
  // decides whether the arc must be clipped to its side of the line.
  const outlineOwnedBy = (owner: Role) => (a: GeometryObject, b: GeometryObject) => {
    const ra = roles.get(a) ?? "none";
    if (a === b) return ra === owner;
    const rb = roles.get(b) ?? "none";
    return (ra === owner && rb === "none") || (rb === owner && ra === "none");
  };
  const outlinePure = path(mesh(topo, gc, outlineOwnedBy("pure"))) ?? "";
  const outlineTrans = split ? (path(mesh(topo, gc, outlineOwnedBy("trans"))) ?? "") : "";

  let side: ContinentGeometry["side"] = null;
  if (split) {
    const ring = planarPath(projection, EUROPE_SIDE_RING, true);
    side = {
      // Asia's side is the box minus Europe's ring (even-odd).
      clip: continent === "europe" ? ring : `M0,0H${width}V${height}H0Z${ring}`,
      evenodd: continent === "asia",
      line: planarPath(projection, EUROPE_ASIA_LINE, false),
    };
  }

  const geom: ContinentGeometry = { width, height, countries, outlinePure, outlineTrans, side };
  geometryCache.set(continent, geom);
  return geom;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Same √-scaled green ramp as the world, ČR and USA maps. */
function memberFill(count: number, max: number): { fill: string; stroke: string; width: number } {
  if (count <= 0) {
    return { fill: "oklch(0.93 0.005 145)", stroke: "oklch(0.78 0.005 145)", width: 0.5 };
  }
  const intensity = max > 0 ? Math.sqrt(count / max) : 0;
  return {
    fill: `oklch(${0.92 - intensity * 0.5} ${0.04 + intensity * 0.13} 145)`,
    stroke: "oklch(0.35 0.04 145)",
    width: 0.6,
  };
}

const OUTLINE_COLOR = "oklch(0.42 0.09 150)";
const OUTLINE_WIDTH = 1.5;

export interface RenderContinentMapInput {
  continent: ContinentKey;
  /** Finds per country, keyed by the dataset's numeric id. */
  byCountry: ReadonlyArray<{ code: string; count: number }>;
  /** Display name for a country (localized by the caller). */
  label: (id: string, name: string) => string;
  /** Tooltip text for a member, e.g. "Česko: 30 639 🍀". */
  tooltip: (label: string, count: number) => string;
  ariaLabel: string;
}

/** The complete `<svg>` for one continent tab, as a string. */
export function renderContinentMapSvg(input: RenderContinentMapInput): string {
  const g = getContinentGeometry(input.continent);
  const counts = new Map<string, number>();
  for (const c of input.byCountry) counts.set(c.code, c.count);
  // Same scale as the world tab (global max), so a country keeps its shade
  // when you switch between World and its continent.
  const max = input.byCountry.reduce((m, c) => Math.max(m, c.count), 0);

  const sideId = `geo-${input.continent}-side`;
  const landId = `geo-${input.continent}-land`;
  const LAND = `fill="oklch(0.95 0.004 230)" stroke="oklch(0.88 0.004 230)" stroke-width="0.4" vector-effect="non-scaling-stroke"`;
  const defs: string[] = [];
  const base: string[] = [];
  const members: string[] = [];
  const split: string[] = [];
  const transLand: string[] = [];

  g.countries.forEach((c, i) => {
    if (c.role === "none") {
      // Non-members are inert land: no find colour, no tooltip.
      base.push(`<path d="${c.d}" ${LAND}/>`);
      return;
    }
    const count = counts.get(c.id) ?? 0;
    const { fill, stroke, width } = memberFill(count, max);
    const title = escapeXml(input.tooltip(input.label(c.id, c.name), count));
    if (c.role === "trans") {
      // A split country is used three times (whole as land, its own-side
      // part coloured inside the clip, and as the mask the dividing line is
      // drawn through). Russia at 50m is the heaviest shape on the map, so
      // its geometry is written once and referenced.
      const ref = `geo-${input.continent}-t${i}`;
      defs.push(`<path id="${ref}" d="${c.d}"/>`);
      base.push(`<use href="#${ref}" ${LAND}/>`);
      split.push(
        `<use href="#${ref}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" vector-effect="non-scaling-stroke"><title>${title}</title></use>`,
      );
      transLand.push(`<use href="#${ref}"/>`);
      return;
    }
    members.push(
      `<path d="${c.d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" vector-effect="non-scaling-stroke"><title>${title}</title></path>`,
    );
  });

  const outline = (d: string, clip?: string) =>
    d
      ? `<path d="${d}" fill="none" stroke="${OUTLINE_COLOR}" stroke-width="${OUTLINE_WIDTH}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" pointer-events="none"${clip ? ` clip-path="url(#${clip})"` : ""}/>`
      : "";

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.width} ${g.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeXml(input.ariaLabel)}" class="block h-auto w-full" style="background:oklch(0.92 0.02 220);max-height:85vh">`,
  );
  if (g.side) {
    parts.push(
      `<defs>${defs.join("")}<clipPath id="${sideId}"><path d="${g.side.clip}"${g.side.evenodd ? ' clip-rule="evenodd"' : ""}/></clipPath>` +
        `<clipPath id="${landId}">${transLand.join("")}</clipPath></defs>`,
    );
  }
  parts.push(base.join(""));
  parts.push(members.join(""));
  if (g.side && split.length > 0) {
    parts.push(`<g clip-path="url(#${sideId})">${split.join("")}</g>`);
  }
  parts.push(outline(g.outlinePure));
  if (g.side) {
    parts.push(outline(g.outlineTrans, sideId));
    // The dividing line itself, only where it crosses the split countries'
    // land (Ural, Caucasus, Thrace) — over the sea it would be noise.
    parts.push(outline(g.side.line, landId));
  }
  parts.push("</svg>");
  return parts.join("");
}

/** Weak ETag for a rendered map — the body changes only when counts do. */
export function continentMapEtag(svg: string): string {
  return `W/"${createHash("sha1").update(svg).digest("base64url")}"`;
}
