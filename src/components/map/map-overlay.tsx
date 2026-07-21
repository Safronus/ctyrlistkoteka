import type { MapOverlayGeometry } from "@/lib/mapOverlay";

/** Largest "nice" length (1 / 2 / 5 × 10ⁿ) not exceeding `target` metres —
 *  the scale-bar snapping the desktop app uses. */
function niceLength(target: number): number {
  if (target <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [5, 2, 1]) if (m * pow <= target) return m * pow;
  return pow;
}

function formatScaleLabel(m: number): string {
  return m >= 1000
    ? `${(m / 1000).toLocaleString("cs-CZ")} km`
    : `${m.toLocaleString("cs-CZ")} m`;
}

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
  showScale = false,
  objectFit = "contain",
  idSuffix,
}: {
  geometry: MapOverlayGeometry;
  /** Image natural pixel dimensions — the SVG viewBox. */
  width: number;
  height: number;
  /** Draw the centre pin for radius/dot maps. Off e.g. on the find detail,
   *  where the find's own GPS pin already marks the spot. */
  showCenterPin?: boolean;
  /** Draw a true-scale ruler (bottom-left). Detail pages only — omitted on
   *  thumbnails where it'd be unreadable. */
  showScale?: boolean;
  /** How the underlying `<img>` fits its box. "contain" (detail pages): the
   *  full map shows, container matches the image aspect → the SVG stretches
   *  1:1 and the pin is a fixed-size HTML dot. "cover" (list thumbnails):
   *  the square thumb crops the map, so the SVG slices to match and the
   *  marker is an SVG dot that crops + scales with it (no HTML pin/scale). */
  objectFit?: "contain" | "cover";
  /** Disambiguates the SVG `<defs>` ids when several overlays share a page
   *  (e.g. a location with multiple maps). */
  idSuffix?: string;
}) {
  const { indicator, polygon, radius, center, isGone } = geometry;
  const stroke = isGone ? GONE : RED;
  const gradId = `ovr-radius-${idSuffix ?? "0"}`;
  const hatchId = `ovr-hatch-${idSuffix ?? "0"}`;
  const isCover = objectFit === "cover";
  const markerR = Math.max(width, height) * 0.035;

  return (
    <>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio={isCover ? "xMidYMid slice" : "none"}
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

        {/* Cover mode (thumbnails): the marker is an SVG dot so it crops +
            scales with the sliced map and stays round. */}
        {isCover && center && indicator !== "polygon" && (
          <circle
            cx={center.x * width}
            cy={center.y * height}
            r={markerR}
            fill={isGone ? GONE : RED}
            stroke="#fff"
            strokeWidth={markerR * 0.5}
          />
        )}
      </svg>

      {/* Contain mode (detail): fixed-size HTML pin, always round + visible. */}
      {!isCover && showCenterPin && center && indicator !== "polygon" && (
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

      {!isCover &&
        showScale &&
        geometry.imageWidthMeters > 0 &&
        (() => {
          // Bar ≈ 22 % of the map width, snapped to a nice 1/2/5 length. The
          // wrapper's own width IS the scale length (a % of the container =
          // a % of the image), so the bar reads true metres at any zoom.
          const nice = niceLength(0.22 * geometry.imageWidthMeters);
          const barPct = (nice / geometry.imageWidthMeters) * 100;
          return (
            <div
              className="pointer-events-none absolute bottom-2 left-2 z-10"
              style={{ width: `${barPct}%` }}
              aria-hidden
            >
              <div className="mb-0.5 w-fit rounded bg-white/85 px-1 text-[10px] font-medium leading-tight text-gray-800 shadow-sm">
                {formatScaleLabel(nice)}
              </div>
              <div className="h-1.5 border-x-2 border-b-2 border-gray-800 bg-white/30" />
            </div>
          );
        })()}
    </>
  );
}
