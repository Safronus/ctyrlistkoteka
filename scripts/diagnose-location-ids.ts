/**
 * Diagnostic (and optional repair) for the "location id drifted away
 * from its map's MAP_ID" bug. Run it on the box that has the DB +
 * DATA_DIR:
 *
 *   pnpm diagnose:locations            # READ-ONLY report
 *   pnpm diagnose:locations -- --fix   # apply the corrective renumber
 *
 * Background: each location-map filename ends in a 5-digit MAP_ID, and
 * `location_maps.id` is set straight from it (always correct). The
 * Location row a map belongs to *should* carry that same id — but
 * sync.ts has a "fork" path (scripts/sync.ts, the
 * `maps.location_forked` branch) that, when a MAP_ID slot is already
 * held by a different code, creates the Location with `id = max(id)+1`
 * instead. Renaming location CODES in /admin (without touching
 * MAP_IDs) is the usual trigger — the reshuffled codes collide on
 * existing MAP_ID slots and fork. Once that happens the `byCode`
 * branch pins the location at the wrong id and the freed slot is never
 * reused, so ids above the fork point read too high (e.g. map 00156
 * shows as 00157, and 00156 "disappears").
 *
 * Without --fix the script makes NO writes. It reports:
 *   1. Duplicate MAP_IDs across filenames.
 *   2. Map files that fail to parse.
 *   3. Locations whose id matches none of their maps' ids ("drifted")
 *      and locations with no map at all ("mapless").
 *   4. MAP_IDs that have no Location sitting on that id ("holes").
 *   5. The corrective renumber, ordered so each target id is free when
 *      its UPDATE runs. With --fix it's executed inside one
 *      transaction; otherwise just printed. All three FKs are ON
 *      UPDATE CASCADE, so moving a Location's id carries its finds,
 *      maps and child parent_id along.
 */

import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { parseMapFilename } from "../src/lib/parseFilename";

const prisma = new PrismaClient();

interface PlannedMove {
  from: number;
  to: number;
  note: string;
}

/**
 * Orders renumber moves so each target id is free at the moment its
 * UPDATE runs. The move set is closed when every occupied target is
 * itself a moving row, which holds for genuine drift (a slot is taken
 * either by a hole, or by another drifted location that also moves).
 * A greedy "do whatever target is free now" pass drains all chains; a
 * pure rotation with no hole is broken by parking one member at a temp
 * id first, then placing it last once its target frees.
 *
 * Throws if a target is blocked by a row that is NOT in the move set
 * (e.g. unresolved multi-map drift) — better to refuse than to loop or
 * emit a plan that would hit a unique-violation.
 */
function planRenumber(
  moves: ReadonlyArray<{ from: number; to: number; note: string }>,
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
      throw new Error("planRenumber: no progress — move set is not closed");
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
    // No target free. Either a true cycle (break it) or a blocker that
    // isn't moving (refuse).
    const pendingFroms = new Set(remaining.keys());
    const blockedByNonMover = [...remaining].some(
      ([, v]) => occupied.has(v.to) && !pendingFroms.has(v.to),
    );
    if (blockedByNonMover) {
      throw new Error(
        "planRenumber: a target is occupied by a non-moving row — manual fix needed",
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

async function listMapFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function main() {
  const dataDir = process.env.DATA_DIR ?? "./data";
  const mapsDir = join(dataDir, "maps");

  // ---- 1. filenames → MAP_IDs -------------------------------------------
  const files = await listMapFiles(mapsDir);
  const mapIdToFiles = new Map<number, string[]>();
  const parseFailures: Array<{ file: string; error: string }> = [];
  for (const file of files) {
    const parsed = parseMapFilename(file);
    if (!parsed.ok) {
      parseFailures.push({ file, error: parsed.error });
      continue;
    }
    const arr = mapIdToFiles.get(parsed.value.mapId) ?? [];
    arr.push(file);
    mapIdToFiles.set(parsed.value.mapId, arr);
  }

  const duplicateMapIds = [...mapIdToFiles.entries()]
    .filter(([, fs]) => fs.length > 1)
    .sort((a, b) => a[0] - b[0]);

  // ---- 2. DB rows --------------------------------------------------------
  const locations = await prisma.location.findMany({
    select: { id: true, code: true, parentId: true },
    orderBy: { id: "asc" },
  });
  const maps = await prisma.locationMap.findMany({
    select: { id: true, locationId: true, originalFilename: true },
    orderBy: { id: "asc" },
  });

  const locIds = new Set(locations.map((l) => l.id));
  const mapsByLoc = new Map<number, number[]>();
  for (const m of maps) {
    const arr = mapsByLoc.get(m.locationId) ?? [];
    arr.push(m.id);
    mapsByLoc.set(m.locationId, arr);
  }

  // Drifted: a location that has maps, but none of those maps' ids equals
  // the location's own id. Mapless: a location with no maps at all.
  const drifted: Array<{ id: number; code: string; mapIds: number[] }> = [];
  const mapless: Array<{ id: number; code: string }> = [];
  for (const l of locations) {
    const ids = mapsByLoc.get(l.id) ?? [];
    if (ids.length === 0) {
      mapless.push({ id: l.id, code: l.code });
    } else if (!ids.includes(l.id)) {
      drifted.push({ id: l.id, code: l.code, mapIds: ids.sort((a, b) => a - b) });
    }
  }

  // Holes: MAP_IDs present (file + location_map row) with no Location
  // sitting on that id — the natural home for a drifted row.
  const holes = maps
    .map((m) => m.id)
    .filter((id) => !locIds.has(id))
    .sort((a, b) => a - b);

  // ---- report ------------------------------------------------------------
  const line = (s = "") => process.stdout.write(s + "\n");
  line("════════════════════════════════════════════════════════════");
  line(" Location-id drift diagnostic");
  line("════════════════════════════════════════════════════════════");
  line(`maps dir            : ${mapsDir}`);
  line(`map files on disk   : ${files.length}`);
  line(`location_maps rows  : ${maps.length}`);
  line(`locations rows      : ${locations.length}`);
  line("");

  line("── 1. Duplicate MAP_IDs across filenames ───────────────────");
  if (duplicateMapIds.length === 0) {
    line("  none — every filename has a unique MAP_ID. ✓");
  } else {
    line("  ⚠ THIS IS ALMOST CERTAINLY THE ROOT CAUSE. Two files share a");
    line("    MAP_ID, so one of them forces a forked (max+1) Location id.");
    for (const [mapId, fs] of duplicateMapIds) {
      line(`    MAP_ID ${String(mapId).padStart(5, "0")}:`);
      for (const f of fs) line(`      - ${f}`);
    }
  }
  line("");

  line("── 2. Unparseable map filenames ────────────────────────────");
  if (parseFailures.length === 0) line("  none ✓");
  else for (const f of parseFailures) line(`  ✗ ${f.file}\n      ${f.error}`);
  line("");

  line("── 3. Drifted / mapless locations ──────────────────────────");
  if (drifted.length === 0 && mapless.length === 0) {
    line("  none — every location sits on one of its maps' ids. ✓");
  }
  for (const d of drifted) {
    line(
      `  DRIFT  location id ${String(d.id).padStart(5, "0")} (${d.code}) ` +
        `→ its map(s): ${d.mapIds.map((n) => String(n).padStart(5, "0")).join(", ")}`,
    );
  }
  for (const m of mapless) {
    line(`  MAPLESS location id ${String(m.id).padStart(5, "0")} (${m.code}) — no map_row`);
  }
  line("");

  line("── 4. MAP_IDs with no Location on that id (holes) ──────────");
  if (holes.length === 0) line("  none ✓");
  else line("  " + holes.map((n) => String(n).padStart(5, "0")).join(", "));
  line("");

  // ---- 5. corrective renumber -------------------------------------------
  // Single-map drift is auto-planned: the location's only map's id IS
  // the slot it belongs in. Multi-map drift is ambiguous (which map
  // should the id follow?) so it's flagged for manual handling instead.
  const singleMapMoves = drifted
    .filter((d) => d.mapIds.length === 1)
    .map((d) => ({ from: d.id, to: d.mapIds[0]!, note: d.code }));
  const multiMapDrift = drifted.filter((d) => d.mapIds.length > 1);

  line("── 5. Corrective renumber ──────────────────────────────────");
  if (duplicateMapIds.length > 0) {
    line("  ⚠ Fix the duplicate filenames in section 1 FIRST, then re-run.");
    line("");
  }
  for (const d of multiMapDrift) {
    line(
      `  ⚠ MANUAL: location ${String(d.id).padStart(5, "0")} (${d.code}) has ` +
        `several maps (${d.mapIds.map((n) => String(n).padStart(5, "0")).join(", ")}) ` +
        `— decide which id it should take by hand.`,
    );
  }

  let plan: PlannedMove[] = [];
  let planError: string | null = null;
  try {
    plan = planRenumber(
      singleMapMoves,
      locations.map((l) => l.id),
      maps.map((m) => m.id),
    );
  } catch (err) {
    planError = err instanceof Error ? err.message : String(err);
  }

  const apply = process.argv.slice(2).includes("--fix");

  if (planError) {
    line(`  ✗ Could not build a safe plan: ${planError}`);
  } else if (plan.length === 0) {
    line("  nothing to renumber — every location sits on its map id. ✓");
  } else {
    line("  finds.location_id, location_maps.location_id and");
    line("  locations.parent_id are ON UPDATE CASCADE — each UPDATE carries");
    line("  its dependents along. Order is computed so each target is free");
    line("  when its UPDATE runs:");
    line("");
    line("  BEGIN;");
    for (const mv of plan) {
      line(`    UPDATE locations SET id = ${mv.to} WHERE id = ${mv.from}; -- ${mv.note}`);
    }
    line("  COMMIT;");
    line("");

    if (apply) {
      if (duplicateMapIds.length > 0 || multiMapDrift.length > 0) {
        line("  ✗ Refusing --fix while duplicate filenames or multi-map");
        line("    drift remain (see warnings above). Resolve those first.");
      } else {
        line("  --fix given → applying inside a transaction…");
        await prisma.$transaction(async (tx) => {
          for (const mv of plan) {
            await tx.$executeRaw`UPDATE locations SET id = ${mv.to} WHERE id = ${mv.from}`;
          }
        });
        line(`  ✓ Applied ${plan.length} renumber(s). Re-run without --fix to confirm.`);
      }
    } else {
      line("  (read-only) Re-run with `-- --fix` to apply this transaction,");
      line("  or paste the SQL above into psql. Take a pg_dump backup first.");
    }
  }
  line("════════════════════════════════════════════════════════════");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
