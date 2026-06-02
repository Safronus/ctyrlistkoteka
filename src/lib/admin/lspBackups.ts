import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicWrite, ensureDir } from "@/lib/admin/atomic";
import { LOKACE_STAVY_POZNAMKY_FILENAME } from "@/lib/admin/jsonSchema";
import { ADMIN_ROOTS } from "@/lib/admin/paths";

/**
 * Rotating backups of LokaceStavyPoznamky.json. A snapshot of the live
 * file is taken before every merge (and before a restore), kept under
 * `data/.admin/backups/lokace-stavy-poznamky/` and capped at the
 * MAX_BACKUPS newest — older ones are pruned. The admin editor page
 * lists them with a one-click restore. (This is separate from, and on
 * top of, the CLAUDE.md §9 `.trash` snapshot, which has its own 30-day
 * retention.)
 */

export const MAX_BACKUPS = 10;
const BACKUP_SUBDIR = "lokace-stavy-poznamky";
const META_FILE = path.join(ADMIN_ROOTS.meta, LOKACE_STAVY_POZNAMKY_FILENAME);

function backupsDir(): string {
  return path.join(ADMIN_ROOTS.backups, BACKUP_SUBDIR);
}

/** Filename-safe, lexicographically-sortable timestamp, e.g.
 *  `2026-06-02T08-16-38-229Z`. ISO order = chronological order. */
function backupTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Validates a backup filename — only our timestamp.json shape, no
 *  traversal, no hidden files. */
export function safeBackupName(name: string): string {
  if (
    !/^[0-9T\-Z]+\.json$/.test(name) ||
    name.includes("..") ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    throw new Error(`Invalid backup name: ${name}`);
  }
  return name;
}

/** Newest-first list of backup filenames. */
async function listBackupNames(): Promise<string[]> {
  try {
    const entries = await fs.readdir(backupsDir());
    return entries
      .filter((n) => n.endsWith(".json") && !n.startsWith("."))
      .sort()
      .reverse();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Snapshot the current live file, then prune to the MAX_BACKUPS newest.
 *  No-op (returns null) when the live file doesn't exist yet. */
export async function createBackup(): Promise<string | null> {
  let content: string;
  try {
    content = await fs.readFile(META_FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const dir = backupsDir();
  await ensureDir(dir);
  const name = `${backupTimestamp()}.json`;
  await atomicWrite(path.join(dir, name), content);

  const names = await listBackupNames(); // newest first
  await Promise.all(
    names.slice(MAX_BACKUPS).map((n) =>
      fs.rm(path.join(dir, n), { force: true }).catch(() => {}),
    ),
  );
  return name;
}

export interface BackupInfo {
  name: string;
  /** Restored ISO timestamp parsed from the filename. */
  createdAtIso: string;
  sizeBytes: number;
}

/** `2026-06-02T08-16-38-229Z.json` → `2026-06-02T08:16:38.229Z`. */
function parseBackupIso(name: string): string | null {
  const base = name.replace(/\.json$/, "");
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(base);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : null;
}

/** Newest-first backups with their timestamp + size, for the GUI. */
export async function listBackups(): Promise<BackupInfo[]> {
  const names = await listBackupNames();
  const out: BackupInfo[] = [];
  for (const name of names) {
    try {
      const st = await fs.stat(path.join(backupsDir(), name));
      out.push({
        name,
        createdAtIso: parseBackupIso(name) ?? st.mtime.toISOString(),
        sizeBytes: st.size,
      });
    } catch {
      /* skip unreadable entry */
    }
  }
  return out;
}

/** Read a backup's content by (validated) name. */
export async function readBackup(name: string): Promise<string> {
  const safe = safeBackupName(name);
  return fs.readFile(path.join(backupsDir(), safe), "utf8");
}
