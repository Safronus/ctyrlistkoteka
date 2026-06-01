import { describe, it, expect } from "vitest";
import {
  computeLocationDrift,
  planLocationRenumber,
  type PlannedMove,
  type RenumberMove,
} from "./locationIdReconcile";

/**
 * Applies a plan to an occupancy set the way Postgres would (each
 * UPDATE moves one row), asserting every target is free at the moment
 * its move runs (no unique violation), and traces each row's identity
 * through temp parks. Returns finalId-by-origin so callers can assert
 * every drifted location landed on its intended id.
 */
function simulate(
  currentIds: readonly number[],
  plan: readonly PlannedMove[],
): Map<number, number> {
  const occupied = new Set<number>(currentIds);
  // identity: which original `from` currently lives at each id
  const originAt = new Map<number, number>();
  for (const id of currentIds) originAt.set(id, id);

  for (const mv of plan) {
    expect(occupied.has(mv.to), `target ${mv.to} must be free`).toBe(false);
    expect(occupied.has(mv.from), `source ${mv.from} must be occupied`).toBe(
      true,
    );
    const origin = originAt.get(mv.from)!;
    occupied.delete(mv.from);
    originAt.delete(mv.from);
    occupied.add(mv.to);
    originAt.set(mv.to, origin);
  }

  // finalId keyed by original id
  const finalByOrigin = new Map<number, number>();
  for (const [id, origin] of originAt) finalByOrigin.set(origin, id);
  return finalByOrigin;
}

describe("computeLocationDrift", () => {
  it("treats a location sitting on one of its map ids as healthy", () => {
    const { singleMapMoves, multiMapDrift } = computeLocationDrift(
      [{ id: 10, code: "A" }],
      [{ id: 10, locationId: 10 }],
    );
    expect(singleMapMoves).toEqual([]);
    expect(multiMapDrift).toEqual([]);
  });

  it("treats a multi-map location healthy when any map carries its id", () => {
    const { singleMapMoves, multiMapDrift } = computeLocationDrift(
      [{ id: 10, code: "A" }],
      [
        { id: 10, locationId: 10 },
        { id: 11, locationId: 10 },
      ],
    );
    expect(singleMapMoves).toEqual([]);
    expect(multiMapDrift).toEqual([]);
  });

  it("flags single-map drift as an auto-fixable move", () => {
    const { singleMapMoves, multiMapDrift } = computeLocationDrift(
      [{ id: 157, code: "NOVÝSMOKOVEC_001" }],
      [{ id: 156, locationId: 157 }],
    );
    expect(singleMapMoves).toEqual([
      { from: 157, to: 156, note: "NOVÝSMOKOVEC_001" },
    ]);
    expect(multiMapDrift).toEqual([]);
  });

  it("routes multi-map drift to manual handling, never an auto move", () => {
    const { singleMapMoves, multiMapDrift } = computeLocationDrift(
      [{ id: 22, code: "M" }],
      [
        { id: 23, locationId: 22 },
        { id: 24, locationId: 22 },
      ],
    );
    expect(singleMapMoves).toEqual([]);
    expect(multiMapDrift).toEqual([{ id: 22, code: "M", mapIds: [23, 24] }]);
  });

  it("ignores mapless locations", () => {
    const { singleMapMoves, multiMapDrift } = computeLocationDrift(
      [{ id: 5, code: "orphan" }],
      [],
    );
    expect(singleMapMoves).toEqual([]);
    expect(multiMapDrift).toEqual([]);
  });
});

describe("planLocationRenumber", () => {
  it("resolves the real production rotation through the single hole", () => {
    // Drift observed on the VPS: 116 is a hole, everything 5..159 is
    // shifted by one. Each location should land on its map's id.
    const moves: RenumberMove[] = [
      { from: 5, to: 116, note: "KŘIBY-V001" },
      { from: 154, to: 5, note: "KŘIBY-V003" },
      { from: 155, to: 154, note: "OKRUŽNÍ004" },
      { from: 156, to: 155, note: "UTB-U5-Z003" },
      { from: 157, to: 156, note: "NOVÝSMOKOVEC_001" },
      { from: 158, to: 157, note: "NOVÝSMOKOVEC_002" },
      { from: 159, to: 158, note: "UTB-U5-000" },
    ];
    const currentIds = [1, 2, 3, 5, 154, 155, 156, 157, 158, 159];
    const allMapIds = [1, 2, 3, 5, 116, 154, 155, 156, 157, 158];

    const plan = planLocationRenumber(moves, currentIds, allMapIds);
    // No temp parks needed — the hole lets a plain chain resolve.
    expect(plan.every((p) => p.to <= 158)).toBe(true);

    const finalByOrigin = simulate(currentIds, plan);
    for (const m of moves) {
      expect(finalByOrigin.get(m.from)).toBe(m.to);
    }
  });

  it("breaks a hole-less rotation with a temp park", () => {
    // loc 10 wants slot 11, loc 11 wants slot 10 — a pure 2-cycle.
    const moves: RenumberMove[] = [
      { from: 10, to: 11, note: "A" },
      { from: 11, to: 10, note: "B" },
    ];
    const currentIds = [10, 11];
    const allMapIds = [10, 11];

    const plan = planLocationRenumber(moves, currentIds, allMapIds);
    // One park is needed since neither target is initially free.
    expect(plan.length).toBe(3);
    const finalByOrigin = simulate(currentIds, plan);
    expect(finalByOrigin.get(10)).toBe(11);
    expect(finalByOrigin.get(11)).toBe(10);
  });

  it("returns an empty plan when there is nothing to move", () => {
    expect(planLocationRenumber([], [1, 2, 3], [1, 2, 3])).toEqual([]);
  });

  it("refuses when a target is blocked by a non-moving row", () => {
    // 30 wants slot 31, but 31 is occupied by a row that isn't moving.
    expect(() =>
      planLocationRenumber(
        [{ from: 30, to: 31, note: "X" }],
        [30, 31],
        [31],
      ),
    ).toThrow(/non-moving row/);
  });
});
