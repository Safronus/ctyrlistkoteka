import { promises as fs } from "node:fs";
import path from "node:path";

/** Files / dirs touched by deploy/blocklist-tools.sh firewall-deny and
 *  the permaban-firewall fail2ban action chain. Read read-only here
 *  to surface live permaban state on the admin page. Paths are
 *  env-overridable so dev / fixture tests can point elsewhere.
 *
 *  Po migraci z nginx permaban (viz deploy/migrate-nginx-permaban-to-nftables.sh)
 *  source of truth už není permaban-list.conf, ale elements.nft
 *  načítané do nftables sety `inet permaban permaban_{v4,v6}`. */
export const PERMABAN_ELEMENTS_PATH =
  process.env.PERMABAN_ELEMENTS_PATH ?? "/var/lib/permaban/elements.nft";
export const PERMABAN_WHITELIST_PATH =
  process.env.PERMABAN_WHITELIST_PATH ?? "/etc/permaban-whitelist.conf";
export const PERMABAN_REFRESH_LOG_PATH =
  process.env.PERMABAN_REFRESH_LOG_PATH ?? "/var/log/permaban-refresh.log";
export const PERMABAN_FIREWALL_LOG_PATH =
  process.env.PERMABAN_FIREWALL_LOG_PATH ?? "/var/log/permaban-firewall.log";
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

/** A single line from /var/log/permaban-firewall.log parsed into a
 *  structured event. Mirrors messages emitted by
 *  permaban-firewall-add.sh: Added / Already present / Whitelist skip /
 *  Reserved skip / Reject invalid IP shape / ERROR. */
export interface PermabanRealtimeEvent {
  ts: string;
  kind: "added" | "skip" | "error" | "info";
  ip?: string;
  /** Když je k dispozici (přes `(permaban_v4)` suffix v log line),
   *  markuje rodinu setu, do kterého IP padla. */
  family?: "v4" | "v6";
  message: string;
}

function parseRealtimeLine(raw: string): PermabanRealtimeEvent | null {
  const m = /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[^ ]+)\s+(.*)$/.exec(raw);
  if (!m) return null;
  const ts = m[1]!;
  const rest = m[2]!;

  // `Added: 1.2.3.4 (permaban_v4)` — suffix s rodinou je volitelný.
  const added = /^Added:\s+(\S+)(?:\s+\((permaban_v[46])\))?/.exec(rest);
  if (added) {
    const fam = added[2];
    return {
      ts,
      kind: "added",
      ip: added[1],
      family:
        fam === "permaban_v6"
          ? "v6"
          : fam === "permaban_v4"
            ? "v4"
            : undefined,
      message: rest,
    };
  }

  const skip =
    /^(Whitelist skip|Reserved skip|Already present):\s+(\S+)/.exec(rest);
  if (skip) return { ts, kind: "skip", ip: skip[2], message: rest };

  const reject = /^Reject\s+invalid\s+IP\s+shape:\s+(\S+)/.exec(rest);
  if (reject) return { ts, kind: "error", ip: reject[1], message: rest };

  if (/^ERROR:/.test(rest)) return { ts, kind: "error", message: rest };

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
  // Pattern z deploy/blocklist-tools.sh firewall-deny — soubory mají
  // formát `elements.<iso-ts>.nft`. Starší `permaban-list.*` snapshoty
  // z legacy nginx permaban jsou pro novou UI ignorované; uživatel je
  // může najít ručně přes `ls /var/backups/permaban/`.
  const matching = entries.filter(
    (n) => n.startsWith("elements.") && n.endsWith(".nft"),
  );
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
  const valid = stats.filter((x): x is PermabanBackup => x !== null);
  valid.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return { error: null, count: valid.length, recent: valid.slice(0, limit) };
}

export interface PermabanSnapshot {
  paths: {
    elements: string;
    whitelist: string;
    refreshLog: string;
    firewallLog: string;
    backupDir: string;
  };
  firewall: {
    error: PermabanFileError | null;
    mtime: string | null;
    size: number | null;
    /** Flat list všech aktuálně permabanovaných IP (v4 + v6 míchané),
     *  v pořadí načtení ze souboru. */
    permabanedIps: string[];
    /** Počty per rodina — pro stats panel. */
    v4Count: number;
    v6Count: number;
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
  const [elements, whitelist, refreshLog, firewallLog, backups] =
    await Promise.all([
      readFileSafe(PERMABAN_ELEMENTS_PATH),
      readFileSafe(PERMABAN_WHITELIST_PATH),
      readFileSafe(PERMABAN_REFRESH_LOG_PATH),
      readFileSafe(PERMABAN_FIREWALL_LOG_PATH),
      listBackups(PERMABAN_BACKUP_DIR),
    ]);

  const permabanedIps: string[] = [];
  let v4Count = 0;
  let v6Count = 0;
  if (elements.content !== null) {
    for (const raw of elements.content.split("\n")) {
      const line = raw.trim();
      // Format: `add element inet permaban permaban_v4 { 1.2.3.4 }`
      // Whitespace mezi `{` a IP může být libovolný. Ignoruje `flush
      // set` řádky a komentáře (začínají #).
      const m =
        /^add\s+element\s+inet\s+permaban\s+(permaban_v[46])\s*\{\s*([^}\s]+)\s*\}/.exec(
          line,
        );
      if (m) {
        const family = m[1]!;
        const ip = m[2]!;
        permabanedIps.push(ip);
        if (family === "permaban_v4") v4Count++;
        else if (family === "permaban_v6") v6Count++;
      }
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
  if (firewallLog.content !== null) {
    const lines = firewallLog.content
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
      elements: PERMABAN_ELEMENTS_PATH,
      whitelist: PERMABAN_WHITELIST_PATH,
      refreshLog: PERMABAN_REFRESH_LOG_PATH,
      firewallLog: PERMABAN_FIREWALL_LOG_PATH,
      backupDir: PERMABAN_BACKUP_DIR,
    },
    firewall: {
      error: elements.error,
      mtime: elements.mtime,
      size: elements.size,
      permabanedIps,
      v4Count,
      v6Count,
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
      error: firewallLog.error,
      events,
    },
    backups,
  };
}
