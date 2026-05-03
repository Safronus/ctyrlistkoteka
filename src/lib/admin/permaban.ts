import { promises as fs } from "node:fs";
import path from "node:path";

/** Files / dirs touched by deploy/blocklist-tools.sh + the
 *  permaban-nginx fail2ban action chain. The page reads them
 *  read-only to surface the live deny list state. Paths are env-
 *  overridable so dev / fixture tests can point elsewhere. */
export const PERMABAN_DENY_PATH =
  process.env.PERMABAN_DENY_PATH ??
  "/etc/nginx/snippets/permaban-list.conf";
export const PERMABAN_WHITELIST_PATH =
  process.env.PERMABAN_WHITELIST_PATH ?? "/etc/permaban-whitelist.conf";
export const PERMABAN_REFRESH_LOG_PATH =
  process.env.PERMABAN_REFRESH_LOG_PATH ?? "/var/log/permaban-refresh.log";
export const PERMABAN_REALTIME_LOG_PATH =
  process.env.PERMABAN_REALTIME_LOG_PATH ?? "/var/log/permaban-nginx.log";
export const PERMABAN_BACKUP_DIR =
  process.env.PERMABAN_BACKUP_DIR ?? "/var/backups/permaban";

export type PermabanFileError = "missing" | "permission" | "io";

interface FileRead {
  content: string | null;
  mtime: string | null;
  size: number | null;
  error: PermabanFileError | null;
}

async function readFileSafe(filePath: string): Promise<FileRead> {
  try {
    const [content, stat] = await Promise.all([
      fs.readFile(filePath, "utf8"),
      fs.stat(filePath),
    ]);
    return {
      content,
      mtime: stat.mtime.toISOString(),
      size: stat.size,
      error: null,
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT")
      return { content: null, mtime: null, size: null, error: "missing" };
    if (e.code === "EACCES")
      return { content: null, mtime: null, size: null, error: "permission" };
    return { content: null, mtime: null, size: null, error: "io" };
  }
}

/** A single line from /var/log/permaban-nginx.log parsed into a
 *  structured event. Mirrors the messages emitted by
 *  permaban-nginx-add.sh: Added / Already present / Whitelist skip /
 *  Reserved skip / Reject invalid IP shape / fallback messages. */
export interface PermabanRealtimeEvent {
  ts: string;
  kind: "added" | "skip" | "error" | "info";
  ip?: string;
  message: string;
}

function parseRealtimeLine(raw: string): PermabanRealtimeEvent | null {
  const m = /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[^ ]+)\s+(.*)$/.exec(raw);
  if (!m) return null;
  const ts = m[1]!;
  const rest = m[2]!;

  const added = /^Added:\s+(\S+)/.exec(rest);
  if (added) return { ts, kind: "added", ip: added[1], message: rest };

  const skip =
    /^(Whitelist skip|Reserved skip|Already present):\s+(\S+)/.exec(rest);
  if (skip) return { ts, kind: "skip", ip: skip[2], message: rest };

  const reject = /^Reject\s+invalid\s+IP\s+shape:\s+(\S+)/.exec(rest);
  if (reject) return { ts, kind: "error", ip: reject[1], message: rest };

  return { ts, kind: "info", message: rest };
}

export interface PermabanBackup {
  name: string;
  mtime: string;
  size: number;
}

interface BackupListing {
  error: PermabanFileError | null;
  count: number;
  /** Most recent N snapshots, newest first. */
  recent: PermabanBackup[];
}

async function listBackups(
  dir: string,
  limit = 10,
): Promise<BackupListing> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return { error: "missing", count: 0, recent: [] };
    if (e.code === "EACCES")
      return { error: "permission", count: 0, recent: [] };
    return { error: "io", count: 0, recent: [] };
  }
  const matching = entries.filter((n) => n.startsWith("permaban-list."));
  const stats = await Promise.all(
    matching.map(async (name) => {
      try {
        const s = await fs.stat(path.join(dir, name));
        return { name, mtime: s.mtime.toISOString(), size: s.size };
      } catch {
        return null;
      }
    }),
  );
  const valid = stats.filter(
    (x): x is PermabanBackup => x !== null,
  );
  valid.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return { error: null, count: valid.length, recent: valid.slice(0, limit) };
}

export interface PermabanSnapshot {
  paths: {
    deny: string;
    whitelist: string;
    refreshLog: string;
    realtimeLog: string;
    backupDir: string;
  };
  deny: {
    error: PermabanFileError | null;
    mtime: string | null;
    size: number | null;
    deniedIps: string[];
  };
  whitelist: {
    error: PermabanFileError | null;
    ips: string[];
  };
  refreshLog: {
    error: PermabanFileError | null;
    /** Last lines of /var/log/permaban-refresh.log (cron rebuild
     *  stdout/stderr). Newest last so the UI can reverse for display. */
    recentLines: string[];
  };
  realtimeLog: {
    error: PermabanFileError | null;
    /** Parsed log events. Newest first (UI-ready). */
    events: PermabanRealtimeEvent[];
  };
  backups: BackupListing;
}

/** Loads everything the live-permaban panel needs, in parallel. Each
 *  source is independently degradable — when Next.js can't read one
 *  file (e.g. permission), the rest of the panel still renders and
 *  the page surfaces a setfacl hint for that specific path. */
export async function loadPermabanSnapshot(): Promise<PermabanSnapshot> {
  const [deny, whitelist, refreshLog, realtimeLog, backups] =
    await Promise.all([
      readFileSafe(PERMABAN_DENY_PATH),
      readFileSafe(PERMABAN_WHITELIST_PATH),
      readFileSafe(PERMABAN_REFRESH_LOG_PATH),
      readFileSafe(PERMABAN_REALTIME_LOG_PATH),
      listBackups(PERMABAN_BACKUP_DIR),
    ]);

  const deniedIps: string[] = [];
  if (deny.content !== null) {
    for (const raw of deny.content.split("\n")) {
      const line = raw.trim();
      const m = /^deny\s+(\S+);/.exec(line);
      if (m) deniedIps.push(m[1]!);
    }
  }

  const whitelistIps: string[] = [];
  if (whitelist.content !== null) {
    for (const raw of whitelist.content.split("\n")) {
      const line = raw.trim();
      if (line.length === 0 || line.startsWith("#")) continue;
      whitelistIps.push(line);
    }
  }

  const refreshLines: string[] = [];
  if (refreshLog.content !== null) {
    const lines = refreshLog.content
      .split("\n")
      .map((l) => l.replace(/\s+$/, ""))
      .filter((l) => l.length > 0);
    refreshLines.push(...lines.slice(-20));
  }

  const events: PermabanRealtimeEvent[] = [];
  if (realtimeLog.content !== null) {
    const lines = realtimeLog.content
      .split("\n")
      .filter((l) => l.trim().length > 0);
    // Cap at 200 most recent — log can grow unbounded between
    // logrotates, parsing the whole thing on every page load isn't
    // worth it.
    for (const line of lines.slice(-200)) {
      const e = parseRealtimeLine(line);
      if (e) events.push(e);
    }
    events.reverse();
  }

  return {
    paths: {
      deny: PERMABAN_DENY_PATH,
      whitelist: PERMABAN_WHITELIST_PATH,
      refreshLog: PERMABAN_REFRESH_LOG_PATH,
      realtimeLog: PERMABAN_REALTIME_LOG_PATH,
      backupDir: PERMABAN_BACKUP_DIR,
    },
    deny: {
      error: deny.error,
      mtime: deny.mtime,
      size: deny.size,
      deniedIps,
    },
    whitelist: {
      error: whitelist.error,
      ips: whitelistIps,
    },
    refreshLog: {
      error: refreshLog.error,
      recentLines: refreshLines,
    },
    realtimeLog: {
      error: realtimeLog.error,
      events,
    },
    backups,
  };
}
