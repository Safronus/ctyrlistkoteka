"use client";

import { useEffect, useMemo, useRef } from "react";
import { Marker, Popup } from "react-leaflet";
import L, { type Marker as LeafletMarker } from "leaflet";
import { useLocale, useTranslations } from "next-intl";
import type { HighlightFind } from "@/lib/queries/finds";
import { formatDateTimeCs, formatDistance } from "@/lib/format";
import { formatGpsApple } from "@/lib/gpsFormat";

/**
 * Single clover-shaped marker rendered when /mapa receives `?find=N`. The
 * shape mirrors the canvas sprite painted for every other find dot, just
 * scaled up and dressed up: the same four overlapping circles + darker
 * core, plus a white halo and a pulsing ring so the visitor's eye lands
 * on this one point even with the bulk Nálezy layer toggled back on.
 *
 * Built as a Leaflet divIcon (HTML+SVG) rather than a CircleMarker so the
 * thematic shape matches the rest of the map and the pulse can ride on
 * a CSS animation instead of an SVG attribute keyframe (cheaper, plays
 * nicer with `prefers-reduced-motion`).
 *
 * The popup auto-opens after the fitBounds animation settles, mirroring
 * the location-polygon popup behaviour on /mapa.
 */
const HIGHLIGHT_BOX = 44;

export function HighlightFindMarker({
  find,
  onPopupClose,
}: {
  find: HighlightFind;
  /** Fired when the popup closes (X button, ESC, click outside, …).
   *  Wired to MapaShell's highlight-dismiss handler so closing the popup
   *  exits highlight mode in place — the marker disappears, the page
   *  drops back to normal interaction, but the viewport stays put. */
  onPopupClose: () => void;
}) {
  const t = useTranslations("Mapa");
  const tOffset = useTranslations("LocationOffset");
  const locale = useLocale();
  const markerRef = useRef<LeafletMarker | null>(null);
  const isRecord = find.isRecord;

  // Icon HTML is captured per (find, variant) — a fresh icon would force
  // Leaflet to re-render the DOM on every re-render of MapView. The
  // record variant swaps the green clover for a gold one and pins a
  // trophy + Czech-flag badge on it.
  const icon = useMemo(
    () =>
      L.divIcon({
        className: isRecord
          ? "ctyr-find-highlight ctyr-find-highlight--record"
          : "ctyr-find-highlight",
        html: isRecord ? HIGHLIGHT_HTML_RECORD : HIGHLIGHT_HTML,
        iconSize: [HIGHLIGHT_BOX, HIGHLIGHT_BOX],
        iconAnchor: [HIGHLIGHT_BOX / 2, HIGHLIGHT_BOX / 2],
        popupAnchor: [0, -HIGHLIGHT_BOX / 2 + 4],
      }),
    [isRecord],
  );

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    // FitBounds animates ~250 ms; wait one tick beyond that so the
    // popup anchors to the final marker pixel position rather than the
    // mid-zoom one.
    const t = setTimeout(() => marker.openPopup(), 350);
    return () => clearTimeout(t);
  }, [find.id]);

  // The location line is "CODE (displayName)" when the two differ, else
  // just the code — same logic as the /sbirka list title row.
  const showSecondaryName =
    find.locationDisplayName !== null &&
    find.locationDisplayName !== "" &&
    find.locationDisplayName !== find.locationCode;

  return (
    <Marker
      ref={markerRef}
      position={[find.lat, find.lng]}
      icon={icon}
      keyboard={false}
      eventHandlers={{
        // Don't let clicks on this marker reach the map's background
        // handler — clicking the highlighted find shouldn't deselect
        // the location it belongs to.
        click: (e) => L.DomEvent.stopPropagation(e),
        // Closing the popup exits highlight mode at the current
        // viewport (no refit) — see prop docstring above.
        popupclose: () => onPopupClose(),
      }}
    >
      <Popup
        className={
          isRecord
            ? "ctyr-find-highlight-popup ctyr-find-highlight-popup--record"
            : "ctyr-find-highlight-popup"
        }
      >
        {/* Text colours are CSS variables (not literal hex) so the popup
            stays legible in dark theme too — the wrapper background is
            re-tinted dark in globals.css, and these `var(--color-*)`
            tokens flip from dark-on-light to light-on-dark on their own. */}
        <div style={{ minWidth: 200, lineHeight: 1.35 }}>
          <strong
            style={{
              color: isRecord
                ? "var(--color-amber-700)"
                : "var(--color-brand-700)",
              fontSize: 14,
            }}
          >
            {isRecord && "🏆 "}
            {t("highlightFindHeading", { id: find.id })}
          </strong>
          {find.locationCode && (
            <div
              style={{
                marginTop: 4,
                color: "var(--color-gray-900)",
                fontSize: 12,
              }}
            >
              <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                {find.locationCode}
              </span>
              {showSecondaryName && (
                <span style={{ color: "var(--color-gray-500)" }}>
                  {" "}
                  ({find.locationDisplayName})
                </span>
              )}
            </div>
          )}
          {find.foundAt && (
            <div
              style={{
                marginTop: 2,
                color: "var(--color-gray-700)",
                fontSize: 12,
              }}
            >
              {formatDateTimeCs(find.foundAt, locale)}
            </div>
          )}
          <div
            style={{
              marginTop: 2,
              color: "var(--color-gray-700)",
              fontSize: 11,
              fontFamily: "var(--font-mono, monospace)",
            }}
          >
            {formatGpsApple(find.lat, find.lng, locale)}
          </div>
          {find.offset && (
            <div
              style={{
                marginTop: 4,
                color: "var(--color-brand-700)",
                fontSize: 12,
              }}
            >
              {find.offset.mode === "polygon"
                ? find.offset.inside
                  ? tOffset("inside")
                  : tOffset("polygonEdge", {
                      distance: formatDistance(find.offset.meters, locale),
                    })
                : tOffset("mapCenter", {
                    distance: formatDistance(find.offset.meters, locale),
                  })}
            </div>
          )}
        </div>
      </Popup>
    </Marker>
  );
}

// Static HTML — same four-leaf clover as the canvas sprite + the pin
// SVG on the find detail page, just scaled to HIGHLIGHT_BOX. Wrapped
// twice: an outer pulse ring (CSS keyframes) and an inner SVG with a
// white halo backdrop so the green stays legible over OSM tiles.
const HIGHLIGHT_HTML = `
  <span class="ctyr-find-highlight__pulse" aria-hidden="true"></span>
  <svg
    viewBox="0 0 32 32"
    width="32"
    height="32"
    class="ctyr-find-highlight__clover"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="16" cy="16" r="14" fill="#ffffff" />
    <g fill="#15803d">
      <circle cx="16" cy="11" r="5" />
      <circle cx="11" cy="16" r="5" />
      <circle cx="21" cy="16" r="5" />
      <circle cx="16" cy="21" r="5" />
      <circle cx="16" cy="16" r="3" fill="#0f6e34" />
    </g>
  </svg>
`;

// Record variant — the same clover scaled to HIGHLIGHT_BOX but in gold,
// over a gold pulse (via the `--record` CSS modifier), with two corner
// badges: a trophy (bottom-right, white disc) and a tiny Czech flag
// (top-right). Both decorative, so `aria-hidden` throughout.
const HIGHLIGHT_HTML_RECORD = `
  <span class="ctyr-find-highlight__pulse" aria-hidden="true"></span>
  <svg
    viewBox="0 0 32 32"
    width="32"
    height="32"
    class="ctyr-find-highlight__clover"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="16" cy="16" r="14" fill="#ffffff" />
    <g fill="#d97706">
      <circle cx="16" cy="11" r="5" />
      <circle cx="11" cy="16" r="5" />
      <circle cx="21" cy="16" r="5" />
      <circle cx="16" cy="21" r="5" />
      <circle cx="16" cy="16" r="3" fill="#b45309" />
    </g>
  </svg>
  <span
    aria-hidden="true"
    style="position:absolute;right:-3px;bottom:-3px;display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#fff;border:1.5px solid #f59e0b;box-shadow:0 1px 2px rgba(0,0,0,0.4);"
  >
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#b45309" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  </span>
  <span
    aria-hidden="true"
    style="position:absolute;right:-5px;top:-3px;line-height:0;border-radius:2px;overflow:hidden;box-shadow:0 0 0 1.5px #fff,0 1px 2px rgba(0,0,0,0.35);"
  >
    <svg viewBox="0 0 30 20" width="15" height="10">
      <rect width="30" height="10" fill="#ffffff" />
      <rect y="10" width="30" height="10" fill="#d7141a" />
      <polygon points="0,0 15,10 0,20" fill="#11457e" />
    </svg>
  </span>
`;
