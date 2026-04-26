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
 * map move/zoom/resize. If the array reference changes (e.g. after data
 * refresh) we rebuild the layer by depending on it in useEffect.
 */
export function FindDotsLayer({
  coords,
}: {
  coords: ReadonlyArray<readonly [number, number]>;
}) {
  const map = useMap();

  useEffect(() => {
    const layer = createFindDotsLayer(coords);
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, coords]);

  return null;
}
