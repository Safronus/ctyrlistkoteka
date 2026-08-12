import L from "leaflet";

/**
 * Marker for one in-the-wild card, shared by the admin's placement map and
 * the crew's read-only one.
 *
 * The same four-circle clover the public /mapa paints for a find, tinted by
 * lifecycle instead of by theme. A coloured dot said "a thing is here"; the
 * clover says WHAT is here, which matters on a map that also carries a town
 * outline and a scatter circle. Selection gets a dark ring rather than a
 * bigger shape, so the markers keep their size and the eye tracks the
 * position, not the blob.
 *
 * Cached per (colour, selected): Leaflet re-renders a marker's DOM whenever
 * its `icon` prop is a new object, and a hundred of them re-rendering on
 * every pan is exactly the jank these maps cannot afford.
 *
 * Imported only from `"use client"` components — it touches Leaflet, which
 * reads `window` at module load.
 */
const ICON_BOX = 24;
const iconCache = new Map<string, L.DivIcon>();

export function dropCloverIcon(color: string, selected: boolean): L.DivIcon {
  const key = `${color}|${selected}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const icon = L.divIcon({
    className: "",
    html: `
      <svg viewBox="0 0 32 32" width="${ICON_BOX}" height="${ICON_BOX}" aria-hidden="true" focusable="false">
        <circle cx="16" cy="16" r="15" fill="#ffffff" opacity="0.9" />
        ${selected ? '<circle cx="16" cy="16" r="15" fill="none" stroke="#111827" stroke-width="2.5" />' : ""}
        <g fill="${color}">
          <circle cx="16" cy="11" r="5" />
          <circle cx="11" cy="16" r="5" />
          <circle cx="21" cy="16" r="5" />
          <circle cx="16" cy="21" r="5" />
        </g>
        <circle cx="16" cy="16" r="3" fill="${color}" stroke="#ffffff" stroke-width="1" />
      </svg>`,
    iconSize: [ICON_BOX, ICON_BOX],
    iconAnchor: [ICON_BOX / 2, ICON_BOX / 2],
  });
  iconCache.set(key, icon);
  return icon;
}
