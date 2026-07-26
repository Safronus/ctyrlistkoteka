import { describe, it, expect } from "vitest";
import { parseSyncProgress } from "./syncProgress";

/** Verbatim lines from a real production run (2026-07-26), trimmed. */
const RUNNING = `· sync.start dry_run=false only=null data_dir="/var/ctyrlistkoteka/data"
· meta.loaded locations=232 notes=649 state_keys=8 anonymized_specs=72
· maps.scan dir="/var/ctyrlistkoteka/data/maps" variant="v2" count=286
· maps.upsert.progress done=14 total=286 pct=4.9 rate_per_s=23.4 eta_s=12
· maps.upsert.progress done=286 total=286 pct=100 rate_per_s=40.7 eta_s=0
· finds.rename_done locations_checked=286 planned=0 renamed=0 skipped_collision=0
· maps.done variant="v2" upserted_maps=286 upserted_locations=286 children_linked=31
· finds.scan originals=20944 crops=20944
· finds.upsert.progress done=1 total=41888 pct=0 rate_per_s=50 eta_s=838
· finds.upsert.progress done=12564 total=41888 pct=30 rate_per_s=23840.6 eta_s=1 id_from=2969 id_to=3349
`;

const FINISHED =
  RUNNING +
  `· finds.upsert.progress done=41888 total=41888 pct=100 rate_per_s=11404.3 eta_s=0
· finds.done upserted=558 skipped_unchanged=41330 relinked=0 with_gps=558
· prune.report orphan_finds=0 orphan_locations=0 orphan_maps=0
· sync.done parse_failures=0
`;

describe("parseSyncProgress", () => {
  it("returns nulls for a log with no progress yet", () => {
    const p = parseSyncProgress("· sync.start dry_run=false\n");
    expect(p.maps).toBeNull();
    expect(p.finds).toBeNull();
  });

  it("takes the LAST progress line of a phase, not the first", () => {
    const p = parseSyncProgress(RUNNING);
    expect(p.finds).not.toBeNull();
    expect(p.finds!.done).toBe(12564);
    expect(p.finds!.total).toBe(41888);
    expect(p.finds!.remaining).toBe(41888 - 12564);
    expect(p.finds!.fraction).toBeCloseTo(0.3, 2);
    expect(p.finds!.ratePerSecond).toBeCloseTo(23840.6, 1);
    expect(p.finds!.etaSeconds).toBe(1);
    expect(p.finds!.finished).toBe(false);
  });

  it("pins a phase to 100 % once its .done line appears", () => {
    // maps.done is already present in RUNNING, so maps is complete even
    // though the finds phase is still mid-flight.
    const p = parseSyncProgress(RUNNING);
    expect(p.maps!.finished).toBe(true);
    expect(p.maps!.fraction).toBe(1);
    expect(p.maps!.remaining).toBe(0);
    expect(p.maps!.done).toBe(286);
  });

  it("marks both phases complete on a finished run", () => {
    const p = parseSyncProgress(FINISHED);
    expect(p.maps!.finished).toBe(true);
    expect(p.finds!.finished).toBe(true);
    expect(p.finds!.fraction).toBe(1);
    expect(p.finds!.remaining).toBe(0);
  });

  it("exposes the originals/crops split — the finds total counts both", () => {
    const p = parseSyncProgress(RUNNING);
    expect(p.findOriginals).toBe(20944);
    expect(p.findCrops).toBe(20944);
    // 20944 + 20944 === 41888, i.e. the bar's total is FILES, not finds.
    expect(p.findOriginals! + p.findCrops!).toBe(p.finds!.total);
  });

  it("reports the id range covered by the last line", () => {
    const p = parseSyncProgress(RUNNING);
    expect(p.finds!.idFrom).toBe(2969);
    expect(p.finds!.idTo).toBe(3349);
  });

  it("has null ids on an older log that predates id_from/id_to", () => {
    const legacy = "· finds.upsert.progress done=10 total=100 pct=10\n";
    const p = parseSyncProgress(legacy);
    expect(p.finds!.done).toBe(10);
    expect(p.finds!.idFrom).toBeNull();
    expect(p.finds!.idTo).toBeNull();
  });

  it("survives a half-written trailing line", () => {
    const p = parseSyncProgress(RUNNING + "· finds.upsert.progress done=13");
    // The partial line has no `total=`, so the previous complete pair stands.
    expect(p.finds!.total).toBe(41888);
    expect(p.finds!.done).toBe(12564);
  });

  it("handles a phase that finished with nothing to do", () => {
    const p = parseSyncProgress("· maps.done variant=\"v2\" upserted_maps=0\n");
    expect(p.maps!.finished).toBe(true);
    expect(p.maps!.total).toBe(0);
    expect(p.maps!.fraction).toBe(1);
  });
});
