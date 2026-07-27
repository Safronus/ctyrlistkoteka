"use client";

import { Fragment, useEffect, useMemo, useRef } from "react";
import { CircleMarker, Marker, useMap } from "react-leaflet";
import L, { type CircleMarker as LCircleMarker } from "leaflet";
import { UNKNOWN_LOCATION_ID } from "@/lib/constants";
import type { MapLocation } from "@/lib/queries/map";
import { cloverSpriteDataUrl } from "./find-dots-canvas";
import {
  buildLocationPopupHtml,
  type LocationPopupLabels,
} from "./location-popup";

/** Clover glyph size (CSS px) in the NEZNÁMÁ count badge — matched to the dot
 *  itself (r 9 + 2px stroke ≈ 20 px across) so neither one dominates. */
const BADGE_CLOVER_PX = 20;
/** White halo that keeps the count legible without a panel behind it. */
const BADGE_NUMBER_HALO = "rgba(255,255,255,.95)";

/**
 * "🍀 12" over the upper-right of the NEZNÁMÁ dot — the finds parked there are
 * never plotted individually (no known position), so this badge is the only
 * place their number shows on the map itself.
 *
 * Deliberately has NO panel behind it: the clover's own white glow and the
 * number's white halo do the separating, on grass and pavement alike. The
 * count sits BESIDE the clover, never inside it — a three-digit number would
 * overflow the glyph.
 *
 * Returns "" for an empty bucket (nothing to count) and for SSR, where the
 * canvas-rendered sprite isn't available; the "?" glyph stands alone then.
 */
function cloverCountBadgeHtml(count: number, cloverUrl: string | null): string {
  if (count <= 0 || cloverUrl === null) return "";
  const n = Math.round(count);
  return (
    // Anchored so the clover overlaps the dot's upper-right quadrant (reads as
    // attached) while leaving the "?" underneath fully visible.
    '<span style="position:absolute;left:11px;bottom:9px;display:inline-flex;' +
    'align-items:center;gap:1px;white-space:nowrap;pointer-events:none;">' +
    `<img src="${cloverUrl}" width="${BADGE_CLOVER_PX}" height="${BADGE_CLOVER_PX}" alt="" ` +
    'style="display:block;filter:drop-shadow(0 1px 1px rgba(0,0,0,.45)) ' +
    'drop-shadow(0 0 2px rgba(255,255,255,.95));" />' +
    '<span style="font:800 13px/1 ui-sans-serif,system-ui,sans-serif;color:#0f172a;' +
    `text-shadow:0 0 3px ${BADGE_NUMBER_HALO},0 0 2px ${BADGE_NUMBER_HALO},` +
    `0 1px 1px ${BADGE_NUMBER_HALO};">${n}</span></span>`
  );
}

/**
 * For locations with no AOI polygon recorded, render a small dot at the
 * map's centre point so the place is at least visible/clickable. With a
 * polygon, LocationPolygons handles it instead — this component is the
 * fallback layer.
 */
export function LocationDots({
  locations,
  focusLocationId,
  enabledChildPolygonIds,
  showGone,
  suppressPopupAutoOpen = false,
  enablePopup = true,
  popupLabels,
  onSelect,
}: {
  locations: readonly MapLocation[];
  focusLocationId: number | null;
  /** IDs of child locations the visitor opted into via the sidebar eye
   *  (or that carry `showOnMapByDefault`). Mirrors LocationPolygons:
   *  top-level dots always render; a CHILD's dot only renders when its
   *  id is in this set, so polygon-less sub-parts stay hidden by default
   *  and become toggleable instead of always cluttering the parent. */
  enabledChildPolygonIds: ReadonlySet<number>;
  /** Mirror the polygon-layer toggle: hide former-location dots when
   *  the visitor has the Zaniklé layer off. */
  showGone: boolean;
  /** When true, the focused dot stays styled but doesn't pop its own
   *  popup. */
  suppressPopupAutoOpen?: boolean;
  /** When false, no Leaflet popup is bound to any dot. */
  enablePopup?: boolean;
  /** Locale-aware labels rendered into the popup HTML. */
  popupLabels?: LocationPopupLabels;
  onSelect?: (id: number) => void;
}) {
  const map = useMap();
  const layerRefs = useRef<Map<number, LCircleMarker>>(new Map());

  // Same sprite as the canvas find dots, so the badge's clover reads as
  // "finds" at a glance. Canvas-rendered → client only (mirrors the guard in
  // selected-location-decor).
  const badgeCloverUrl = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : cloverSpriteDataUrl(0, BADGE_CLOVER_PX),
    [],
  );

  // When focused, open the focused dot's popup once the map's fit-bounds
  // animation settles. Same pattern as LocationPolygons.
  useEffect(() => {
    if (focusLocationId == null) return;
    if (suppressPopupAutoOpen) return;
    if (!enablePopup) return; // popup not bound — top-sheet handles it
    const layer = layerRefs.current.get(focusLocationId);
    if (!layer) return;
    const open = () => layer.openPopup();
    map.once("moveend", open);
    const t = setTimeout(open, 800);
    return () => {
      map.off("moveend", open);
      clearTimeout(t);
    };
  }, [focusLocationId, map, suppressPopupAutoOpen, enablePopup]);

  const dots = locations
    .filter(
      (l): l is MapLocation & { centerLat: number; centerLng: number } =>
        l.polygon === null && l.centerLat !== null && l.centerLng !== null,
    )
    .filter((l) => l.parentId === null || enabledChildPolygonIds.has(l.id))
    .filter((l) => showGone || !l.isGone);

  return (
    <>
      {dots.map((l) => {
        const focused = l.id === focusLocationId;
        // The NEZNÁMÁ bucket (00000) is deliberately the odd one out: neutral
        // GREY (not blue = active, not rose = former), a DASHED ring saying
        // "this isn't a real area", and a "?" glyph so it reads without the
        // legend. Its finds have no GPS and are never plotted — the marker's
        // popup count is the only thing representing them on the map.
        const isUnknown = l.id === UNKNOWN_LOCATION_ID;
        const fill = isUnknown ? "#64748b" : l.isGone ? "#e11d48" : "#1e40af";
        return (
          // `focused` is in the key so the marker REMOUNTS on select/deselect
          // — Leaflet can't move a layer between panes after creation, and the
          // pane flips with selection (below).
          <Fragment
            key={`${l.id}-${enablePopup ? "p" : "np"}-${focused ? "f" : "u"}`}
          >
            {/* Prominence + STACKING invert with selection. NOT selected: bold,
                opaque, in the loc-dots pane ABOVE the finds — so you can spot +
                click a polygon-less place amid a dense cluster (the original
                problem). SELECTED: the dot drops BELOW the finds (overlayPane)
                and goes translucent, so the clover icons (which can sit right
                on top of it) + the green circle play first fiddle; deselecting
                lifts it back on top to be clickable again. */}
            <CircleMarker
              center={[l.centerLat, l.centerLng]}
              radius={isUnknown ? 9 : 6}
              pane={focused ? "overlayPane" : "loc-dots"}
              pathOptions={{
                color: "#ffffff",
                weight: focused ? 1.5 : 2,
                fillColor: fill,
                fillOpacity: focused ? 0.5 : 1,
                ...(isUnknown ? { dashArray: "3 3" } : {}),
              }}
              eventHandlers={{
                add: (e) => {
                  const layer = e.target as LCircleMarker;
                  if (enablePopup && popupLabels) {
                    layer.bindPopup(
                      buildLocationPopupHtml(
                        {
                          id: l.id,
                          code: l.code,
                          displayName: l.displayName,
                          findCount: l.findCount,
                          isGone: l.isGone,
                          isChild: l.parentId !== null,
                        },
                        popupLabels,
                      ),
                    );
                  }
                  layerRefs.current.set(l.id, layer);
                },
                click: (e) => {
                  // Stop the click from reaching the map's background
                  // handler — otherwise the deselect would fire right
                  // after the select.
                  L.DomEvent.stopPropagation(e);
                  onSelect?.(l.id);
                },
                remove: () => {
                  layerRefs.current.delete(l.id);
                },
              }}
            />
            {/* "?" glyph + 🍀 count over the NEZNÁMÁ dot. A separate,
                NON-interactive DivIcon so the CircleMarker above keeps every
                existing behaviour (popup binding, click-to-select, layerRefs)
                — clicks pass straight through this to the circle underneath.
                The "?" stays: it's the "not a real place" signal, while the
                badge answers "how many are parked here". */}
            {isUnknown && (
              <Marker
                position={[l.centerLat, l.centerLng]}
                interactive={false}
                keyboard={false}
                pane={focused ? "overlayPane" : "loc-dots"}
                icon={L.divIcon({
                  className: "",
                  html:
                    '<span style="position:relative;display:flex;align-items:center;' +
                    "justify-content:center;width:18px;height:18px;" +
                    "font:700 11px/1 ui-sans-serif,system-ui,sans-serif;" +
                    'color:#fff;text-shadow:0 1px 1px rgba(0,0,0,.45);">?' +
                    cloverCountBadgeHtml(l.findCount, badgeCloverUrl) +
                    "</span>",
                  iconSize: [18, 18],
                  iconAnchor: [9, 9],
                })}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

