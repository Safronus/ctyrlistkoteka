/**
 * Pure helpers for healing "location id drifted away from its map's
 * MAP_ID" — shared by the sync self-heal phase (scripts/sync.ts) and
 * the standalone diagnostic (scripts/diagnose-location-ids.ts) so both
 * compute the exact same plan.
 *
 * Why drift happens: `location_maps.id` is the filename's MAP_ID
 * (always correct), and a Location *should* sit on the same id as one
 * of its maps. But sync's fork path can create a Location with
 * `id = max(id)+1` when a MAP_ID slot is already held by a different
 * code (the usual trigger is renaming location CODES in /admin, which
 * reshuffles codes across existing MAP_ID slots). The result is a
 * rotation: e.g. map 00156 ends up under location 00157, and 00156
 * "disappears".
 *
 * The repair renumbers each drifted Location back onto its map's id.
 * All FKs on `locations.id` (finds.location_id, location_maps.location_id,
 * locations.parent_id) are ON UPDATE CASCADE, so a plain `UPDATE
 * locations SET id = …` carries dependents along. The only constraint
 * is ordering: a target id must be free when its UPDATE runs.
 */

/** A drifted Location that should move from `from` (its current,
 *  wrong id) to `to` (its single map's MAP_ID). `note` is the code,
 *  for logging. */
export interface RenumberMove {
  from: number;
  to: number;
  note: string;
}

export interface PlannedMove {
  from: number;
  to: number;
  note: string;
}

export interface DriftResult {
  /** Drifted locations with exactly one map — auto-fixable: the move's
   *  target is that map's id. */
  singleMapMoves: RenumberMove[];
  /** Drifted locations with several maps — ambiguous which id they
   *  should take, so they're surfaced for manual handling, never moved
   *  automatically. */
  multiMapDrift: Array<{ id: number; code: string; mapIds: number[] }>;
}

/**
 * Splits drift into auto-fixable single-map moves and ambiguous
 * multi-map cases. A location is healthy when one of its maps already
 * carries its id; mapless locations are ignored here (a different
 * concern). Pure — no DB access.
 */
export function computeLocationDrift(
  locations: ReadonlyArray<{ id: number; code: string }>,
  maps: ReadonlyArray<{ id: number; locationId: number }>,
): DriftResult {
  const mapIdsByLoc = new Map<number, number[]>();
  for (const m of maps) {
    const arr = mapIdsByLoc.get(m.locationId) ?? [];
    arr.push(m.id);
    mapIdsByLoc.set(m.locationId, arr);
  }
  const singleMapMoves: RenumberMove[] = [];
  const multiMapDrift: Array<{ id: number; code: string; mapIds: number[] }> =
    [];
  for (const l of locations) {
    const ids = mapIdsByLoc.get(l.id);
    if (!ids || ids.length === 0) continue; // mapless — not handled here
    if (ids.includes(l.id)) continue; // healthy: a map carries this id
    const sorted = [...ids].sort((a, b) => a - b);
    if (sorted.length === 1) {
      singleMapMoves.push({ from: l.id, to: sorted[0]!, note: l.code });
    } else {
      multiMapDrift.push({ id: l.id, code: l.code, mapIds: sorted });
    }
  }
  return { singleMapMoves, multiMapDrift };
}

/**
 * Orders renumber moves so each target id is free at the moment its
 * UPDATE runs. The move set is closed for genuine drift — every
 * occupied target is itself a moving row (a slot is taken either by a
 * hole, or by another drifted location that also moves) — so a greedy
 * "do whatever target is free now" pass drains all chains. A pure
 * rotation with no hole is broken by parking one member at a temp id
 * (above every current id + MAP_ID) and placing it last once its
 * target frees.
 *
 * Throws if a target is blocked by a row NOT in the move set (e.g.
 * unresolved multi-map drift) — better to refuse than to loop or emit
 * a plan that would hit a unique violation. Pure — no DB access.
 */
export function planLocationRenumber(
  moves: ReadonlyArray<RenumberMove>,
  currentLocationIds: readonly number[],
  allMapIds: readonly number[],
): PlannedMove[] {
  const occupied = new Set<number>(currentLocationIds);
  const remaining = new Map<number, { to: number; note: string }>();
  for (const m of moves) remaining.set(m.from, { to: m.to, note: m.note });
  const plan: PlannedMove[] = [];
  let tempNext = Math.max(0, ...currentLocationIds, ...allMapIds) + 1;
  let guard = moves.length * 4 + 16;

  while (remaining.size > 0) {
    if (guard-- <= 0) {
      throw new Error(
        "planLocationRenumber: no progress — move set is not closed",
      );
    }
    const doable = [...remaining].filter(([, v]) => !occupied.has(v.to));
    if (doable.length > 0) {
      for (const [from, v] of doable) {
        plan.push({ from, to: v.to, note: v.note });
        occupied.delete(from);
        occupied.add(v.to);
        remaining.delete(from);
      }
      continue;
    }
    // No target free. Either a true rotation (break it with a temp) or
    // a blocker that isn't moving (refuse — manual fix needed).
    const pendingFroms = new Set(remaining.keys());
    const blockedByNonMover = [...remaining].some(
      ([, v]) => occupied.has(v.to) && !pendingFroms.has(v.to),
    );
    if (blockedByNonMover) {
      throw new Error(
        "planLocationRenumber: a target is occupied by a non-moving row — manual fix needed",
      );
    }
    const [from, v] = [...remaining][0]!;
    const temp = tempNext++;
    plan.push({ from, to: temp, note: `${v.note} (park → ${temp})` });
    occupied.delete(from);
    occupied.add(temp);
    remaining.delete(from);
    remaining.set(temp, v);
  }
  return plan;
}
