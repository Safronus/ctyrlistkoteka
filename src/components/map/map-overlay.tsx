import type { MapOverlayGeometry } from "@/lib/mapOverlay";

/** Indicator red — matches the desktop app's baked overlays (#D62822). */
const RED = "#D62822";
/** Rose for former/gone places — matches /mapa's gone treatment. */
const GONE = "#e11d48";
/** Radius halo green — matches the /mapa selected-location halo. */
const GREEN = "#16a34a";

/**
 * Vector overlay drawn on top of a clean "Nosná" location-map `<img>`:
 * the location's AOI polygon, radius circle, and/or centre pin, positioned
 * from server-precomputed image fractions ({@link MapOverlayGeometry}). The
 * wrapping element must be `position: relative` and sized to the image's
 * natural aspect ratio so the `preserveAspectRatio="none"` viewBox maps 1:1
 * (square pixels → the radius renders as a true circle).
 *
 * Polygon + radius live in the scaling SVG; the centre pin is a fixed-size
 * HTML element so it stays visible (and round) at any display size — the
 * same "the marker is always visible, decoupled from the radius" rule the
 * desktop app follows.
 */
export function MapOverlay({
  geometry,
  width,
  height,
  showCenterPin = true,
  idSuffix,
}: {
  geometry: MapOverlayGeometry;
  /** Image natural pixel dimensions — the SVG viewBox. */
  width: number;
  height: number;
  /** Draw the centre pin for radius/dot maps. Off e.g. on the find detail,
   *  where the find's own GPS pin already marks the spot. */
  showCenterPin?: boolean;
  /** Disambiguates the SVG `<defs>` ids when several overlays share a page
   *  (e.g. a location with multiple maps). */
  idSuffix?: string;
}) {
  const { indicator, polygon, radius, center, isGone } = geometry;
  const stroke = isGone ? GONE : RED;
  const gradId = `ovr-radius-${idSuffix ?? "0"}`;
  const hatchId = `ovr-hatch-${idSuffix ?? "0"}`;

  return (
    <>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <radialGradient id={gradId}>
            <stop offset="0%" stopColor={GREEN} stopOpacity="0.5" />
            <stop offset="55%" stopColor={GREEN} stopOpacity="0.28" />
            <stop offset="100%" stopColor={GREEN} stopOpacity="0" />
          </radialGradient>
          {isGone && (
            <pattern
              id={hatchId}
              width="8"
              height="8"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="8" height="8" fill={GONE} fillOpacity="0.14" />
              <line x1="0" y1="0" x2="0" y2="8" stroke={GONE} strokeWidth="2" strokeOpacity="0.5" />
            </pattern>
          )}
        </defs>

        {polygon && polygon.length >= 3 && (
          <polygon
            points={polygon.map((p) => `${p.x * width},${p.y * height}`).join(" ")}
            fill={isGone ? `url(#${hatchId})` : RED}
            fillOpacity={isGone ? 1 : 0.22}
            stroke={stroke}
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {radius && center && (
          <ellipse
            cx={center.x * width}
            cy={center.y * height}
            rx={radius.rx * width}
            ry={radius.ry * height}
            fill={`url(#${gradId})`}
          />
        )}
      </svg>

      {showCenterPin && center && indicator !== "polygon" && (
        <span
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${center.x * 100}%`, top: `${center.y * 100}%` }}
          aria-hidden
        >
          <span
            className="block rounded-full ring-2 ring-white"
            style={{
              width: 12,
              height: 12,
              backgroundColor: isGone ? GONE : RED,
            }}
          />
        </span>
      )}
    </>
  );
}
