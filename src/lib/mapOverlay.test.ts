import { describe, expect, it } from "vitest";

import {
  computeMapOverlayGeometry,
  latLngToFrac,
  parseImageBounds,
  type ImageBounds,
} from "./mapOverlay";

// A 0.01°×0.01° window around Zlín (~49.22 N, 17.66 E). SW then NE.
const BOUNDS: ImageBounds = [
  [49.22, 17.66],
  [49.23, 17.67],
];

describe("latLngToFrac", () => {
  it("puts the centre at (0.5, 0.5)", () => {
    const f = latLngToFrac(49.225, 17.665, BOUNDS);
    expect(f.x).toBeCloseTo(0.5, 6);
    expect(f.y).toBeCloseTo(0.5, 6);
  });

  it("flips y so north is the top of the image", () => {
    // NE corner → top-right (x=1, y=0); SW corner → bottom-left (x=0, y=1).
    expect(latLngToFrac(49.23, 17.67, BOUNDS)).toEqual({ x: 1, y: 0 });
    expect(latLngToFrac(49.22, 17.66, BOUNDS)).toEqual({ x: 1 - 1, y: 1 });
  });
});

describe("parseImageBounds", () => {
  it("accepts a valid 2×2 tuple", () => {
    expect(parseImageBounds([[49.22, 17.66], [49.23, 17.67]])).toEqual(BOUNDS);
  });
  it("rejects malformed / degenerate bounds", () => {
    expect(parseImageBounds(null)).toBeNull();
    expect(parseImageBounds([[1, 2]])).toBeNull();
    expect(parseImageBounds([[1, 2], [1, 9]])).toBeNull(); // neLat === swLat
  });
});

describe("computeMapOverlayGeometry", () => {
  it("polygon → ring as fractions, no radius", () => {
    const g = computeMapOverlayGeometry({
      indicator: "polygon",
      imageBounds: BOUNDS,
      centerLat: 49.225,
      centerLng: 17.665,
      radiusM: null,
      polygonLngLat: [
        [17.66, 49.22],
        [17.67, 49.22],
        [17.665, 49.23],
      ],
      isGone: false,
    });
    expect(g?.indicator).toBe("polygon");
    expect(g?.polygon).toHaveLength(3);
    expect(g?.radius).toBeNull();
    // First point (SW-ish corner) maps to bottom-left.
    expect(g?.polygon?.[0]).toEqual({ x: 0, y: 1 });
  });

  it("radius → ellipse rx/ry as image fractions", () => {
    const g = computeMapOverlayGeometry({
      indicator: "radius",
      imageBounds: BOUNDS,
      centerLat: 49.225,
      centerLng: 17.665,
      radiusM: 50,
      polygonLngLat: null,
      isGone: false,
    });
    expect(g?.indicator).toBe("radius");
    expect(g?.center?.x).toBeCloseTo(0.5, 6);
    expect(g?.center?.y).toBeCloseTo(0.5, 6);
    // 0.01° lat ≈ 1113 m tall → 50 m ≈ 0.045 of height.
    expect(g?.radius?.ry).toBeCloseTo(50 / (0.01 * 111_320), 4);
    // Width uses cos(lat) so metres-per-degree-lng is smaller → larger frac.
    expect(g?.radius?.rx).toBeGreaterThan(g!.radius!.ry);
  });

  it("radius indicator with no radius_m falls back to a bare dot", () => {
    const g = computeMapOverlayGeometry({
      indicator: "radius",
      imageBounds: BOUNDS,
      centerLat: 49.225,
      centerLng: 17.665,
      radiusM: null,
      polygonLngLat: null,
      isGone: false,
    });
    expect(g?.indicator).toBe("dot");
    expect(g?.radius).toBeNull();
    expect(g?.center?.x).toBeCloseTo(0.5, 6);
    expect(g?.center?.y).toBeCloseTo(0.5, 6);
  });

  it("polygon indicator with a degenerate ring returns null", () => {
    const g = computeMapOverlayGeometry({
      indicator: "polygon",
      imageBounds: BOUNDS,
      centerLat: 49.225,
      centerLng: 17.665,
      radiusM: null,
      polygonLngLat: [[17.66, 49.22]],
      isGone: false,
    });
    expect(g).toBeNull();
  });

  it("carries the gone flag through", () => {
    const g = computeMapOverlayGeometry({
      indicator: "dot",
      imageBounds: BOUNDS,
      centerLat: 49.225,
      centerLng: 17.665,
      radiusM: null,
      polygonLngLat: null,
      isGone: true,
    });
    expect(g?.isGone).toBe(true);
  });
});
