/**
 * READ-ONLY diagnostic for the "location id drifted away from its map's
 * MAP_ID" bug. Run it on the box that has the DB + DATA_DIR:
 *
 *   pnpm diagnose:locations
 *
 * Background: each location-map filename ends in a 5-digit MAP_ID, and
 * `location_maps.id` is set straight from it (always correct). The
 * Location row a map belongs to *should* carry that same id — but
 * sync.ts has a "fork" path (scripts/sync.ts, the
 * `maps.location_forked` branch) that, when a MAP_ID slot is already
 * held by a different code, creates the Location with `id = max(id)+1`
 * instead. Once that happens the `byCode` branch pins the location at
 * the wrong id forever and the freed slot is never reused, so every id
 * above the fork point reads one too high (e.g. map 00156 shows as
 * 00157, and 00156 "disappears").
 *
 * This script makes NO writes. It reports:
 *   1. Duplicate MAP_IDs across filenames (the usual trigger).
 *   2. Map files that fail to parse.
 *   3. Locations whose id matches none of their maps' ids ("drifted")
 *      and locations with no map at all ("mapless").
 *   4. MAP_IDs that have no Location sitting on that id ("holes" — the
 *      slots a corrective renumber would move drifted rows back into).
 *   5. A proposed corrective transaction (review before running — all
 *      three FKs are ON UPDATE CASCADE, so moving a Location's id
 *      carries finds, maps and child parent_id with it).
 */

import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { parseMapFilename } from "../src/lib/parseFilename";

const prisma = new PrismaClient();

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

  // ---- 5. proposed corrective transaction --------------------------------
  // Only auto-suggest for single-map drifted locations whose target slot
  // (the map's id) is currently a hole. Sort by target ascending so an
  // upward +1 shift frees each slot just before the next move needs it.
  const moves = drifted
    .filter((d) => d.mapIds.length === 1 && holes.includes(d.mapIds[0]!))
    .map((d) => ({ from: d.id, to: d.mapIds[0]!, code: d.code }))
    .sort((a, b) => a.to - b.to);

  line("── 5. Proposed corrective renumber (REVIEW BEFORE RUNNING) ──");
  if (duplicateMapIds.length > 0) {
    line("  Fix the duplicate filenames in section 1 FIRST (renumber one");
    line("  of each pair to a free unique MAP_ID, rsync, re-sync). Only");
    line("  then renumber the already-drifted rows below.");
    line("");
  }
  if (moves.length === 0) {
    line("  nothing auto-suggestable (no single-map drift into a free hole).");
  } else {
    line("  All of finds.location_id, location_maps.location_id and");
    line("  locations.parent_id are ON UPDATE CASCADE, so each UPDATE below");
    line("  carries its finds, maps and children along. Order matters: it");
    line("  assumes a simple upward shift (each target freed by the prior");
    line("  move). Verify against sections 3–4, then run inside ONE txn:");
    line("");
    line("  BEGIN;");
    for (const mv of moves) {
      line(
        `    UPDATE locations SET id = ${mv.to} WHERE id = ${mv.from}; ` +
          `-- ${mv.code}`,
      );
    }
    line("  COMMIT;");
    line("");
    line("  (Then bump the id sequence if one exists, and re-run this");
    line("   script to confirm everything is clean.)");
  }
  line("════════════════════════════════════════════════════════════");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
