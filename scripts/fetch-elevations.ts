/**
 * One-off enrichment: terrain elevation for every location's centre point.
 *
 *   pnpm tsx scripts/fetch-elevations.ts [--force] [--dry-run]
 *
 * WHY A DEM AND NOT THE PHOTOS
 * ----------------------------
 * The photos do carry EXIF GPSAltitude, and it was measured over the whole
 * collection (29 068 readings): per location the middle 50 % of readings span
 * 0.6–12 m, with individual outliers 400 m off — a cold GPS fix writes
 * nonsense. A median over the finds would work, but a digital elevation model
 * read at the location's centre is both more accurate and doesn't need every
 * photo re-read. See docs/gotchas.md.
 *
 * THIRD-PARTY CALL — READ BEFORE CHANGING
 * ---------------------------------------
 * CLAUDE.md §9 says the site must not send data to third parties. This script
 * is a deliberate, owner-approved exception, and it is narrow:
 *
 *   • It is NEVER called at request time. The website reads `altitude_m` from
 *     the DB; nothing user-facing talks to the outside world.
 *   • ANONYMIZED LOCATIONS ARE NEVER SENT. Their coordinates are the thing the
 *     anonymization exists to hide. Non-anonymized location centres are
 *     already public — they are drawn on /mapa — so sending those reveals
 *     nothing new.
 *   • It runs when the owner runs it, and is idempotent: without `--force` it
 *     only fills locations that have no elevation yet, so a re-run after
 *     adding maps costs a handful of requests.
 *
 * DATASETS
 * --------
 * api.opentopodata.org, in order of preference per point: EU-DEM 25 m
 * (Europe, ~±7 m) then SRTM 30 m (global between ±60°, ~±10 m) then ASTER 30 m
 * (fills the far north, where SRTM has no data — Iceland sits at 64°N).
 * Public instance limits: 100 locations per request, 1 call/s, 1000 calls/day.
 */

import "dotenv/config";
import { Prisma } from "@/generated/prisma/client";
import { createPrismaClient } from "@/lib/prismaClient";
import { UNKNOWN_LOCATION_ID } from "@/lib/constants";

const prisma = createPrismaClient();

const API = "https://api.opentopodata.org/v1";
/** The public instance caps a request at 100 points. */
const BATCH = 100;
/** …and at one call per second. Be a good citizen and leave headroom. */
const CALL_DELAY_MS = 1200;
/** Tried in order; the first dataset that returns a value for a point wins. */
const DATASETS = ["eudem25m", "srtm30m", "aster30m"] as const;

interface Row {
  id: number;
  lat: number;
  lng: number;
}

interface ApiResult {
  elevation: number | null;
}

interface ApiResponse {
  status?: string;
  error?: string;
  results?: ApiResult[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Elevations for one batch from one dataset. Returns one entry per input
 *  point, null where the dataset has no data (sea, outside coverage). */
async function lookup(
  dataset: string,
  batch: readonly Row[],
): Promise<(number | null)[]> {
  const locations = batch.map((r) => `${r.lat},${r.lng}`).join("|");
  const res = await fetch(`${API}/${dataset}?locations=${locations}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`${dataset}: HTTP ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as ApiResponse;
  if (body.status !== "OK" || !body.results) {
    throw new Error(`${dataset}: ${body.error ?? "unexpected response"}`);
  }
  if (body.results.length !== batch.length) {
    throw new Error(
      `${dataset}: got ${body.results.length} results for ${batch.length} points`,
    );
  }
  return body.results.map((r) =>
    typeof r.elevation === "number" && Number.isFinite(r.elevation)
      ? r.elevation
      : null,
  );
}

async function main() {
  const force = process.argv.includes("--force");
  const dryRun = process.argv.includes("--dry-run");

  // Anonymized = any of the location's maps carries the anonymized flag. Same
  // rule the public queries use; here it decides what NEVER leaves the box.
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT l.id,
           ROUND(ST_Y(l.center_point)::numeric, 6)::float8 AS lat,
           ROUND(ST_X(l.center_point)::numeric, 6)::float8 AS lng
    FROM locations l
    WHERE l.center_point IS NOT NULL
      -- NEZNÁMÁ (00000) is a parking slot, not a place: its centre is the
      -- default map's arbitrary anchor, so an elevation there would be
      -- fiction. Excluded from the lookup as well as from the ranking.
      AND l.id <> ${UNKNOWN_LOCATION_ID}::int
      AND NOT EXISTS (
        SELECT 1 FROM location_maps lm
        WHERE lm.location_id = l.id AND lm.is_anonymized = true
      )
      ${force ? Prisma.empty : Prisma.sql`AND l.altitude_m IS NULL`}
    ORDER BY l.id
  `;

  const anonCount = await prisma.location.count({
    where: { maps: { some: { isAnonymized: true } } },
  });
  console.log(
    `· lokalit ke zpracování: ${rows.length}` +
      `   (anonymizovaných přeskočeno: ${anonCount})`,
  );
  if (rows.length === 0) return;

  const found = new Map<number, { m: number; source: string }>();
  for (const dataset of DATASETS) {
    const pending = rows.filter((r) => !found.has(r.id));
    if (pending.length === 0) break;
    console.log(`· ${dataset}: ptám se na ${pending.length} bodů`);
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      const values = await lookup(dataset, batch);
      values.forEach((v, j) => {
        if (v !== null) found.set(batch[j]!.id, { m: v, source: dataset });
      });
      if (i + BATCH < pending.length) await sleep(CALL_DELAY_MS);
    }
    await sleep(CALL_DELAY_MS);
  }

  const missing = rows.filter((r) => !found.has(r.id));
  console.log(
    `· hotovo: ${found.size} výšek, bez výsledku ${missing.length}` +
      (missing.length ? ` (id: ${missing.map((m) => m.id).join(", ")})` : ""),
  );

  if (dryRun) {
    for (const r of rows.slice(0, 10)) {
      const f = found.get(r.id);
      console.log(
        `   ${String(r.id).padStart(5)}  ${f ? `${f.m.toFixed(1)} m (${f.source})` : "—"}`,
      );
    }
    console.log("· dry-run: nic se nezapsalo");
    return;
  }

  for (const [id, { m, source }] of found) {
    await prisma.location.update({
      where: { id },
      data: { altitudeM: m, altitudeSource: source },
    });
  }
  console.log(`· zapsáno do DB: ${found.size} lokalit`);
}

main()
  .catch((err) => {
    console.error("· CHYBA:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
