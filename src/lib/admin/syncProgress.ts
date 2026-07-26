/**
 * Derives per-phase progress from the raw sync log the admin panel already
 * streams — no extra endpoint, the panel just parses what's on screen.
 *
 * The `…upsert.progress` lines carry `done`/`total`/`rate_per_s`/`eta_s` plus
 * `id_from`/`id_to` (the find ids / map čísla covered since the previous
 * line). Logs written before sync emitted the id fields parse fine — those
 * two simply come back null.
 *
 * Only the LAST progress line of each phase matters — earlier ones are
 * superseded. A phase's `done` marker (`maps.done` / `finds.done`) pins it to
 * 100 %, which also covers the case where the final progress line was
 * truncated or the phase finished between two polls.
 */

export interface SyncPhaseProgress {
  /** Phase key — matches the log's event prefix. */
  key: "maps" | "finds";
  done: number;
  total: number;
  /** 0..1, clamped. 0 when `total` is 0 (nothing to do). */
  fraction: number;
  /** `total - done`, never negative. */
  remaining: number;
  /** Items per second from the log, or null when not reported yet. */
  ratePerSecond: number | null;
  /** Seconds left per the log's own estimate, or null. */
  etaSeconds: number | null;
  /** Lowest / highest domain id (find id, map číslo) processed in the window
   *  the last progress line covered — answers "which records is it on right
   *  now", which the bare `done` counter can't. Null on older logs written
   *  before sync started emitting id_from/id_to. */
  idFrom: number | null;
  idTo: number | null;
  /** True once the phase's `*.done` line appeared. */
  finished: boolean;
}

/** Numeric `field=…` within a single log line. */
function num(line: string, field: string): number | null {
  const m = new RegExp(`\\b${field}=(-?[0-9]+(?:\\.[0-9]+)?)`).exec(line);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Last COMPLETE line for `event` that carries every field in `required`.
 *
 * Whole-line matching is load-bearing: the log is streamed in byte chunks, so
 * the buffer routinely ends mid-line. Reading each field independently across
 * the whole buffer let a half-written `…progress done=13` pair its `done` with
 * a `total` from an earlier line — a desynced, wrong bar. Requiring one line
 * to carry all of them means a partial tail is simply ignored until complete.
 */
function lastLine(
  log: string,
  event: string,
  required: readonly string[],
): string | null {
  let found: string | null = null;
  for (const line of log.split("\n")) {
    if (!line.includes(event)) continue;
    if (required.some((f) => num(line, f) === null)) continue;
    found = line;
  }
  return found;
}

/** Last value of `field` on a complete line of `event`. */
function lastNumber(log: string, event: string, field: string): number | null {
  const line = lastLine(log, event, [field]);
  return line === null ? null : num(line, field);
}

function phase(
  log: string,
  key: SyncPhaseProgress["key"],
): SyncPhaseProgress | null {
  const event = `${key}.upsert.progress`;
  // done + total MUST come from the same line — see lastLine().
  const line = lastLine(log, event, ["done", "total"]);
  const done = line === null ? null : num(line, "done");
  const total = line === null ? null : num(line, "total");
  // `finished` can be true before any progress line exists — a phase with
  // nothing to do logs only its `.done` summary.
  const finished = new RegExp(`\\b${key}\\.done\\b`).test(log);
  if (line === null || done === null || total === null) {
    if (!finished) return null;
    return {
      key,
      done: 0,
      total: 0,
      fraction: 1,
      remaining: 0,
      ratePerSecond: null,
      etaSeconds: null,
      idFrom: null,
      idTo: null,
      finished: true,
    };
  }
  const safeTotal = Math.max(0, total);
  const safeDone = Math.min(Math.max(0, done), safeTotal || done);
  return {
    key,
    done: finished ? safeTotal : safeDone,
    total: safeTotal,
    fraction: finished ? 1 : safeTotal > 0 ? safeDone / safeTotal : 0,
    remaining: finished ? 0 : Math.max(0, safeTotal - safeDone),
    ratePerSecond: finished ? null : num(line, "rate_per_s"),
    etaSeconds: finished ? null : num(line, "eta_s"),
    idFrom: finished ? null : num(line, "id_from"),
    idTo: finished ? null : num(line, "id_to"),
    finished,
  };
}

export interface SyncProgress {
  maps: SyncPhaseProgress | null;
  finds: SyncPhaseProgress | null;
  /** From `finds.scan originals=… crops=…` — the finds phase counts BOTH,
   *  so the bar's total is files, not finds. Kept so the UI can say so. */
  findOriginals: number | null;
  findCrops: number | null;
}

/** Parses the accumulated sync log into per-phase progress. Safe on partial
 *  input — a half-written line simply doesn't match and the previous value
 *  stands. */
export function parseSyncProgress(log: string): SyncProgress {
  return {
    maps: phase(log, "maps"),
    finds: phase(log, "finds"),
    findOriginals: lastNumber(log, "finds.scan", "originals"),
    findCrops: lastNumber(log, "finds.scan", "crops"),
  };
}
