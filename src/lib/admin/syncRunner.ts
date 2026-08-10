import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { revalidatePublicSurfaces } from "../revalidate";
import { ADMIN_ROOTS } from "./paths";
import { atomicWrite, ensureDir, trashTimestamp } from "./atomic";
import { expiredBuckets } from "./trash";
import { writeLastSyncSuccess } from "./syncNeeded";

/** State machine for the admin sync runner.
 *
 *  PM2 cluster mode runs two Next.js workers, so any in-memory state
 *  is invisible to half the requests. Persist everything to disk
 *  under `data/.admin/` and let any worker read/update it. The
 *  child process itself is bound to whichever worker spawned it; if
 *  that worker dies, the next status read will notice the PID is
 *  gone and transition the state to `crashed`. */

export type SyncState =
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "crashed";

export interface SyncStatus {
  /** Stable identifier for this run — also the log filename suffix. */
  runId: string;
  state: SyncState;
  /** Argv passed to scripts/sync.ts (excluding the binary). */
  args: string[];
  /** Absolute path of the log file the child writes stdout+stderr to. */
  logFile: string;
  /** Child process PID while running. Cleared on exit. */
  pid: number | null;
  startedAt: string;
  endedAt: string | null;
  /** Process exit code when state ∈ {succeeded, failed, crashed}. */
  exitCode: number | null;
  /** Label of the credential that started the run (audit trail). */
  startedBy: string;
}

const ADMIN_DIR = path.join(ADMIN_ROOTS.meta, "..", ".admin");
const STATUS_FILE = path.join(ADMIN_DIR, "sync-status.json");
const LOG_DIR = path.join(ADMIN_DIR, "logs");

/**
 * Drops sync logs past the trash retention window.
 *
 * One file per run, named `sync-<runId>.log` where the run id is a
 * `trashTimestamp()` — so the same dating rules apply, and a file whose
 * name we can't read is a file we leave alone. Runs when a sync starts,
 * for the same reason the trash prunes on write: the directory only
 * grows when a run happens.
 *
 * Never throws — failing to tidy old logs must not stop a sync.
 */
async function pruneSyncLogs(): Promise<void> {
  try {
    const names = await fs.readdir(LOG_DIR);
    const stamps = names
      .map((n) => /^sync-(\d{8}T\d{6})\.log$/.exec(n))
      .filter((m): m is RegExpExecArray => m !== null);
    const expired = new Set(
      expiredBuckets(
        stamps.map((m) => m[1]!),
        new Date(),
      ),
    );
    await Promise.all(
      stamps
        .filter((m) => expired.has(m[1]!))
        .map((m) => fs.rm(path.join(LOG_DIR, m[0]), { force: true })),
    );
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "sync_log_prune_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Pid liveness check via `kill -0`. Returns true when the process
 *  exists, false on ESRCH (no such process), throws on EPERM (which
 *  shouldn't happen since we own the child). */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    throw err;
  }
}

/** Reads the status JSON. Returns null when no run has happened yet
 *  (file doesn't exist). When the file says `running` but the child
 *  PID is no longer alive, transitions to `crashed` and persists. */
export async function getStatus(): Promise<SyncStatus | null> {
  let raw: string;
  try {
    raw = await fs.readFile(STATUS_FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: SyncStatus;
  try {
    parsed = JSON.parse(raw) as SyncStatus;
  } catch {
    return null;
  }
  if (parsed.state === "running" && parsed.pid !== null) {
    if (!isPidAlive(parsed.pid)) {
      const repaired: SyncStatus = {
        ...parsed,
        state: "crashed",
        pid: null,
        endedAt: new Date().toISOString(),
        exitCode: null,
      };
      await atomicWrite(STATUS_FILE, JSON.stringify(repaired, null, 2));
      return repaired;
    }
  }
  return parsed;
}

export interface StartOptions {
  dryRun: boolean;
  /** Limit the run to one source — `--only=maps|finds|meta`. */
  only?: "maps" | "finds" | "meta";
  startedBy: string;
}

/** Spawns scripts/sync.ts with the requested flags. Throws when a
 *  sync is already running. Caller is expected to have done auth +
 *  audit before calling.
 *
 *  The child runs under the same node binary using the local tsx CLI
 *  — no PATH lookup needed, so PM2's restricted env can't break the
 *  invocation. stdout+stderr are merged into a single log file. */
export async function startRun(opts: StartOptions): Promise<SyncStatus> {
  const current = await getStatus();
  if (current && current.state === "running") {
    throw new Error("Sync už běží — počkej na dokončení nebo na crash watchdog.");
  }

  const args = ["scripts/sync.ts"];
  if (opts.dryRun) args.push("--dry-run");
  if (opts.only) args.push(`--only=${opts.only}`);

  const runId = trashTimestamp();
  await ensureDir(LOG_DIR);
  await ensureDir(ADMIN_DIR);
  await pruneSyncLogs();
  const logFile = path.join(LOG_DIR, `sync-${runId}.log`);

  // Open the log file before spawn so child stdout is written from
  // byte 0 — `appendFile` would race against the polling reader.
  await fs.writeFile(logFile, "");

  const tsxBin = path.join(
    process.cwd(),
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );
  const logHandle = await fs.open(logFile, "a");
  const child = spawn(process.execPath, [tsxBin, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", logHandle.fd, logHandle.fd],
  });

  const startedAt = new Date().toISOString();
  const status: SyncStatus = {
    runId,
    state: "running",
    args,
    logFile,
    pid: child.pid ?? null,
    startedAt,
    endedAt: null,
    exitCode: null,
    startedBy: opts.startedBy,
  };
  await atomicWrite(STATUS_FILE, JSON.stringify(status, null, 2));

  child.on("exit", async (code, signal) => {
    try {
      await logHandle.close();
    } catch {
      /* swallow */
    }
    const final: SyncStatus = {
      ...status,
      state: code === 0 ? "succeeded" : "failed",
      pid: null,
      endedAt: new Date().toISOString(),
      exitCode: code ?? (signal ? -1 : null),
    };
    try {
      await atomicWrite(STATUS_FILE, JSON.stringify(final, null, 2));
    } catch (err) {
      console.error("[admin/sync] failed to write final status", { err });
    }
    if (final.state === "succeeded") {
      try {
        await writeLastSyncSuccess({
          endedAt: final.endedAt!,
          args: final.args,
          runId: final.runId,
        });
      } catch (err) {
        console.error("[admin/sync] failed to write last-success marker", {
          err,
        });
      }
      // Drop every cache layer that depends on freshly synced data — the
      // `unstable_cache` stats aggregations (tag "stats") AND the ISR route
      // caches — so the user doesn't see stale numbers after adding finds,
      // which would defeat the purpose of running a sync. Same helper the
      // CLI path reaches via /api/admin/revalidate. PM2 cluster mode is
      // fine: the writes land in the shared on-disk .next/cache.
      try {
        revalidatePublicSurfaces();
      } catch (err) {
        console.error("[admin/sync] revalidate after sync failed", { err });
      }
    }
  });

  // Detach the parent's reference to the file descriptor — once spawn
  // duped it for the child, we don't need our handle. (The handle
  // close in the exit listener above keeps the FD open until then so
  // child writes still flush.)
  child.unref();

  return status;
}

/** Returns the bytes of the log file from `offset` onwards. Cheap
 *  enough to call on every poll — log files are small (a few MB max
 *  for a full sync). */
export async function tailLog(
  runId: string,
  offset: number,
): Promise<{ bytes: string; nextOffset: number }> {
  const logFile = path.join(LOG_DIR, `sync-${runId}.log`);
  let stat;
  try {
    stat = await fs.stat(logFile);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { bytes: "", nextOffset: 0 };
    }
    throw err;
  }
  if (offset >= stat.size) {
    return { bytes: "", nextOffset: stat.size };
  }
  const stream = createReadStream(logFile, {
    start: offset,
    end: stat.size - 1,
    encoding: "utf8",
  });
  let bytes = "";
  for await (const chunk of stream) bytes += chunk;
  return { bytes, nextOffset: stat.size };
}
