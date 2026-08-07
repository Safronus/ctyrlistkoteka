import { describe, expect, it } from "vitest";
import {
  boundaryBBox,
  boundaryVertexCount,
  pointInBoundary,
  readBoundary,
  scatterInBoundary,
  simplifyBoundary,
  type BoundaryGeometry,
} from "./dropBoundary";

/** A unit square with a square hole in the middle — the shape that
 *  matters, because an enclave inside a town must count as outside. */
const SQUARE_WITH_HOLE: BoundaryGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
    [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
      [4, 4],
    ],
  ],
};

describe("readBoundary", () => {
  it("accepts a Polygon", () => {
    expect(readBoundary(SQUARE_WITH_HOLE)?.type).toBe("Polygon");
  });

  it("accepts a MultiPolygon", () => {
    const g = readBoundary({
      type: "MultiPolygon",
      coordinates: [SQUARE_WITH_HOLE.coordinates],
    });
    expect(g?.type).toBe("MultiPolygon");
  });

  it.each([
    ["null", null],
    ["a string", "Zlín"],
    ["a LineString", { type: "LineString", coordinates: [[0, 0]] }],
    ["empty coordinates", { type: "Polygon", coordinates: [] }],
    ["a ring of two points", { type: "Polygon", coordinates: [[[0, 0], [1, 1]]] }],
  ])("rejects %s", (_label, raw) => {
    expect(readBoundary(raw)).toBeNull();
  });
});

describe("pointInBoundary", () => {
  it("is true inside", () => {
    expect(pointInBoundary(SQUARE_WITH_HOLE, 2, 2)).toBe(true);
  });

  it("is false outside", () => {
    expect(pointInBoundary(SQUARE_WITH_HOLE, 20, 20)).toBe(false);
  });

  it("is false inside a hole — an enclave is not the town", () => {
    expect(pointInBoundary(SQUARE_WITH_HOLE, 5, 5)).toBe(false);
  });

  it("handles a MultiPolygon's second part", () => {
    const g: BoundaryGeometry = {
      type: "MultiPolygon",
      coordinates: [
        SQUARE_WITH_HOLE.coordinates,
        [
          [
            [100, 100],
            [101, 100],
            [101, 101],
            [100, 101],
            [100, 100],
          ],
        ],
      ],
    };
    expect(pointInBoundary(g, 100.5, 100.5)).toBe(true);
    expect(pointInBoundary(g, 50, 50)).toBe(false);
  });
});

describe("boundaryBBox", () => {
  it("spans the outer ring", () => {
    expect(boundaryBBox(SQUARE_WITH_HOLE)).toEqual({
      minLat: 0,
      minLng: 0,
      maxLat: 10,
      maxLng: 10,
    });
  });
});

describe("simplifyBoundary", () => {
  it("drops collinear filler but keeps the corners", () => {
    // A square whose edges carry pointless midpoints.
    const noisy: BoundaryGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [5, 0],
          [10, 0],
          [10, 5],
          [10, 10],
          [5, 10],
          [0, 10],
          [0, 5],
          [0, 0],
        ],
      ],
    };
    const out = simplifyBoundary(noisy, 0.001);
    expect(boundaryVertexCount(out)).toBeLessThan(boundaryVertexCount(noisy));
    // Still a closed ring, still covering the same ground.
    const ring = (out as { coordinates: number[][][] }).coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(pointInBoundary(out, 5, 5)).toBe(true);
    expect(pointInBoundary(out, 15, 5)).toBe(false);
  });

  it("never thins a ring below a triangle", () => {
    const tri: BoundaryGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [0, 1],
          [0, 0],
        ],
      ],
    };
    // A tolerance far bigger than the shape would otherwise collapse it.
    const out = simplifyBoundary(tri, 100);
    expect(boundaryVertexCount(out)).toBeGreaterThanOrEqual(4);
  });
});

describe("scatterInBoundary", () => {
  it("puts every point inside, and none in the hole", () => {
    let seed = 1;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const { points, short } = scatterInBoundary(SQUARE_WITH_HOLE, 200, random);
    expect(short).toBe(0);
    expect(points).toHaveLength(200);
    for (const p of points) {
      expect(pointInBoundary(SQUARE_WITH_HOLE, p.lat, p.lng)).toBe(true);
    }
  });

  it("reports how many it could not place", () => {
    // A sliver so thin that the bounding box is almost all outside.
    const sliver: BoundaryGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 9.999999],
          [10, 10],
          [0, 0.000001],
          [0, 0],
        ],
      ],
    };
    const { points, short } = scatterInBoundary(sliver, 50, () => 0.5);
    expect(points.length + short).toBe(50);
  });
});
