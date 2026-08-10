import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { atomicWrite, ensureDir, trashTimestamp } from "./atomic";
import { ADMIN_ROOTS, GENERATED_ROOT } from "./paths";
import { COLLAGE_VARIANTS, type CollageVariant } from "@/lib/collage";

/**
 * Runs `scripts/generate-collage.ts` as a child process and tracks it.
 *
 * Same shape as `syncRunner`, for the same reason: a full run over 30 000
 * crops takes minutes, which is far past any request. State lives in a
 * file so it survives the request that started it and so BOTH PM2 workers
 * see the same answer — an in-memory flag would let two runs start at
 * once and fight over the same output files.
 */

const ADMIN_DIR = path.join(ADMIN_ROOTS.meta, "..", ".admin");
const STATUS_FILE = path.join(ADMIN_DIR, "collage-status.json");
const LOG_DIR = path.join(ADMIN_DIR, "logs");
/** Custom batches land here, one directory per run. Never the live
 *  `collage/` names — those are the frozen 30 000 backgrounds and
 *  overwriting them has to be asked for. */
const BATCH_ROOT = path.join(GENERATED_ROOT, "collage", "vzory");

export interface CollageRunStatus {
  runId: string;
  state: "running" | "succeeded" | "failed" | "crashed";
  /** Empty when the run wrote over the live backgrounds. */
  batchDir: string | null;
  /** Public URL prefix for the batch, for download links. */
  batchUrl: string | null;
  minId: number;
  maxId: number;
  variants: CollageVariant[];
  /** True when this run replaced what `/d/<token>` actually serves. */
  live: boolean;
  logFile: string;
  pid: number | null;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  startedBy: string;
}

export interface StartCollageOptions {
  minId: number;
  maxId: number;
  variants: CollageVariant[];
  /** Overwrite the backgrounds the landing pages serve. Off by default —
   *  the 30 000 collages are frozen on purpose. */
  live: boolean;
  startedBy: string;
}

export async function getCollageStatus(): Promise<CollageRunStatus | null> {
  try {
    const raw = await fs.readFile(STATUS_FILE, "utf8");
    const status = JSON.parse(raw) as CollageRunStatus;
    if (status.state !== "running") return status;
    // Same watchdog as the sync runner: a worker restart mid-run leaves
    // "running" behind forever, and then nothing can ever start again.
    if (status.pid !== null && !isAlive(status.pid)) {
      const crashed: CollageRunStatus = {
        ...status,
        state: "crashed",
        pid: null,
        endedAt: new Date().toISOString(),
      };
      await atomicWrite(STATUS_FILE, JSON.stringify(crashed, null, 2));
      return crashed;
    }
    return status;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startCollageRun(
  opts: StartCollageOptions,
): Promise<CollageRunStatus> {
  const current = await getCollageStatus();
  if (current?.state === "running") {
    throw new Error("Generování už běží — počkej, než doběhne.");
  }
  if (!Number.isInteger(opts.minId) || opts.minId < 1) {
    throw new Error("Od čísla musí být kladné celé číslo.");
  }
  if (!Number.isInteger(opts.maxId) || opts.maxId < opts.minId) {
    throw new Error("Do čísla musí být aspoň tolik, co Od čísla.");
  }
  const variants = opts.variants.filter((v) => COLLAGE_VARIANTS.includes(v));
  if (variants.length === 0) throw new Error("Vyber aspoň jednu koláž.");

  const runId = trashTimestamp();
  const batchDir = opts.live ? null : path.join(BATCH_ROOT, runId);
  const args = [
    "scripts/generate-collage.ts",
    `--min-id=${opts.minId}`,
    `--max-id=${opts.maxId}`,
  ];
  // The script takes one --only; several variants mean several runs, so
  // pass none and let it build the lot when everything is selected.
  if (variants.length === 1) args.push(`--only=${variants[0]}`);
  if (batchDir) args.push(`--out-dir=${batchDir}`);

  await ensureDir(LOG_DIR);
  await ensureDir(ADMIN_DIR);
  if (batchDir) await ensureDir(batchDir);
  const logFile = path.join(LOG_DIR, `collage-${runId}.log`);
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

  const status: CollageRunStatus = {
    runId,
    state: "running",
    batchDir,
    batchUrl: batchDir ? `/generated/collage/vzory/${runId}` : null,
    minId: opts.minId,
    maxId: opts.maxId,
    variants,
    live: opts.live,
    logFile,
    pid: child.pid ?? null,
    startedAt: new Date().toISOString(),
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
    const final: CollageRunStatus = {
      ...status,
      state: code === 0 ? "succeeded" : "failed",
      pid: null,
      endedAt: new Date().toISOString(),
      exitCode: code ?? (signal ? -1 : null),
    };
    try {
      await atomicWrite(STATUS_FILE, JSON.stringify(final, null, 2));
    } catch (err) {
      console.error("[admin/collage] failed to write final status", { err });
    }
  });

  return status;
}

/** Last `maxBytes` of the run's log, for the live view. */
export async function tailCollageLog(maxBytes = 16_384): Promise<string> {
  const status = await getCollageStatus();
  if (!status) return "";
  try {
    const handle = await fs.open(status.logFile, "r");
    try {
      const { size } = await handle.stat();
      const from = Math.max(0, size - maxBytes);
      const buf = Buffer.alloc(size - from);
      await handle.read(buf, 0, buf.length, from);
      return buf.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

export interface CollageBatch {
  runId: string;
  url: string;
  files: Array<{ name: string; url: string; bytes: number }>;
  builtAt: string | null;
}

/**
 * Finished custom batches, newest first.
 *
 * Read off disk rather than tracked in a table: these are files somebody
 * asked for and will delete by hand, and a list that disagrees with the
 * directory is worse than no list.
 */
export async function listCollageBatches(
  limit = 12,
): Promise<CollageBatch[]> {
  let names: string[];
  try {
    names = await fs.readdir(BATCH_ROOT);
  } catch {
    return [];
  }
  const batches: CollageBatch[] = [];
  for (const runId of names.sort().reverse().slice(0, limit)) {
    const dir = path.join(BATCH_ROOT, runId);
    try {
      const entries = await fs.readdir(dir);
      const files = [];
      let newest: number | null = null;
      for (const name of entries.filter((n) => n.endsWith(".webp")).sort()) {
        const s = await fs.stat(path.join(dir, name));
        files.push({
          name,
          url: `/generated/collage/vzory/${runId}/${name}`,
          bytes: s.size,
        });
        newest = Math.max(newest ?? 0, s.mtimeMs);
      }
      if (files.length > 0) {
        batches.push({
          runId,
          url: `/generated/collage/vzory/${runId}`,
          files,
          builtAt: newest ? new Date(newest).toISOString() : null,
        });
      }
    } catch {
      // A half-written batch is simply not listed.
    }
  }
  return batches;
}
