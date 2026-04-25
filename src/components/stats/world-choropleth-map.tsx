"use client";

import { GeoJSON, MapContainer, useMap } from "react-leaflet";
import { useEffect, useMemo, useRef } from "react";
import type { Layer, PathOptions } from "leaflet";
import type { Feature, Geometry } from "geojson";
import "leaflet/dist/leaflet.css";
import {
  getWorldCountries,
  type CountryFeatureProps,
} from "@/lib/world-countries";
import type { CountryPoint } from "@/lib/queries/stats";

interface Props {
  byCountry: readonly CountryPoint[];
}

/**
 * Choropleth world map — countries are filled green according to their
 * find share, the rest of the landmass stays a flat neutral. No tile
 * layer: a pure outline ("blind") map keeps the gradient unambiguous,
 * and there's no need for OSM imagery on a country-level visualisation.
 *
 * Find counts are pre-computed by the server (`byCountry`) and joined
 * to the GeoJSON features by ISO 3166-1 numeric — the same identifier
 * `geo.ts` returns from its point-in-polygon resolver.
 */
export function WorldChoroplethMap({ byCountry }: Props) {
  const countByCode = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    for (const c of byCountry) m.set(c.code, { name: c.name, count: c.count });
    return m;
  }, [byCountry]);

  const max = useMemo(
    () => byCountry.reduce((m, c) => Math.max(m, c.count), 0),
    [byCountry],
  );

  const featureCollection = useMemo(() => getWorldCountries(), []);

  return (
    // `relative z-0` pins Leaflet's internal panes (which use z-index 200..700
    // for tile/overlay/tooltip stacks) inside a fresh stacking context. Without
    // it, a path pane at z-400 outranks the sticky page header at z-40 and
    // overlaps the navigation when the user scrolls past the choropleth.
    <div className="relative z-0 overflow-hidden rounded-xl border border-gray-200">
      <MapContainer
        center={[25, 10]}
        zoom={2}
        minZoom={1}
        maxZoom={6}
        scrollWheelZoom={false}
        worldCopyJump={false}
        zoomControl={false}
        attributionControl={false}
        className="h-96 w-full"
        style={{ background: "oklch(0.92 0.02 220)" }}
      >
        <CountriesLayer
          features={featureCollection}
          countByCode={countByCode}
          max={max}
        />
        <DisableInteractionsOnMobile />
      </MapContainer>
    </div>
  );
}

function CountriesLayer({
  features,
  countByCode,
  max,
}: {
  features: ReturnType<typeof getWorldCountries>;
  countByCode: Map<string, { name: string; count: number }>;
  max: number;
}) {
  const styleFor = (count: number): PathOptions => {
    if (count <= 0) {
      return {
        fillColor: "oklch(0.93 0.005 145)",
        fillOpacity: 1,
        color: "oklch(0.78 0.005 145)",
        weight: 0.5,
      };
    }
    // √-scaling so countries with a handful of finds are still
    // distinguishable from blank landmass without making every active
    // country look identical to the dominant one.
    const t = max > 0 ? Math.sqrt(count / max) : 0;
    const L = 0.92 - t * 0.5;
    const C = 0.04 + t * 0.13;
    return {
      fillColor: `oklch(${L} ${C} 145)`,
      fillOpacity: 1,
      color: "oklch(0.35 0.04 145)",
      weight: 0.6,
    };
  };

  const onEachFeature = (
    feature: Feature<Geometry, CountryFeatureProps>,
    layer: Layer,
  ) => {
    const entry = countByCode.get(feature.properties.id);
    const count = entry?.count ?? 0;
    const name = entry?.name ?? feature.properties.name;
    layer.bindTooltip(
      `<strong>${escapeHtml(name)}</strong><br/>${count} ${pluralFinds(count)}`,
      { sticky: true, direction: "auto" },
    );
  };

  return (
    <GeoJSON
      data={features}
      style={(feature) => {
        const id = (feature?.properties as CountryFeatureProps | undefined)?.id;
        const count = id ? countByCode.get(id)?.count ?? 0 : 0;
        return styleFor(count);
      }}
      onEachFeature={onEachFeature as never}
    />
  );
}

/**
 * On touch devices a pinch-zoom inside the embedded map fights the
 * page scroll, which is irritating on a stats page that's primarily
 * about reading numbers. We therefore disable map gestures for coarse
 * pointers — desktop users keep the full interactive map.
 */
function DisableInteractionsOnMobile() {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches
    ) {
      map.dragging.disable();
      map.touchZoom.disable();
      map.doubleClickZoom.disable();
    }
  }, [map]);
  return null;
}

function pluralFinds(n: number): string {
  if (n === 1) return "nález";
  if (n >= 2 && n <= 4) return "nálezy";
  return "nálezů";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
