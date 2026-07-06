"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { createFindDotsLayer } from "./find-dots-canvas";

/**
 * React-Leaflet wrapper around the imperative `FindDotsLayer`. We can't
 * use `react-leaflet`'s declarative primitives here because the layer
 * lives in plain Leaflet — its lifecycle is mount/unmount via `useMap`.
 *
 * `coords` is captured once on mount; redraws happen automatically on
 * map move/zoom/resize. If the array reference or the focus / highlight
 * sets change (e.g. after the user picks a sidebar location, or arrives
 * with /sbirka filter params attached) we rebuild the layer by
 * depending on all three in useEffect.
 */
export function FindDotsLayer({
  coords,
  focusFindIds,
  highlightFindIds,
  hideDeviated,
  showDeviationColors,
  iconSize,
}: {
  coords: ReadonlyArray<readonly [number, number, number, number, number]>;
  focusFindIds: ReadonlySet<number> | null;
  highlightFindIds: ReadonlySet<number> | null;
  /** Vrstvy → Nálezy → "Skrýt odchýlené nálezy" sub-toggle. When true,
   *  finds whose tone (5th slot in the coord tuple) is ≥ 1 (deviated)
   *  are skipped in the canvas hot loop. */
  hideDeviated: boolean;
  /** Vrstvy → Nálezy → "Barevně odlišit odchýlené" sub-toggle. When true,
   *  deviated finds paint amber/rose per their tone; when false every find
   *  paints green. */
  showDeviationColors: boolean;
  /** Sprite size in CSS pixels (from the size slider). */
  iconSize: number;
}) {
  const map = useMap();

  useEffect(() => {
    const layer = createFindDotsLayer(
      coords,
      focusFindIds,
      highlightFindIds,
      hideDeviated,
      showDeviationColors,
      iconSize,
    );
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [
    map,
    coords,
    focusFindIds,
    highlightFindIds,
    hideDeviated,
    showDeviationColors,
    iconSize,
  ]);

  return null;
}
