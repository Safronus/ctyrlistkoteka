import { promises as fs } from "node:fs";

/** Path to the fail2ban blocklist TSV. Configurable so dev/test can
 *  point at a fixture instead of the production log. The format
 *  matches `deploy/blocklist-tools.sh`:
 *
 *      <ISO-timestamp>\t<IP>\t<jail>\t<reason>
 *
 *  Lines that don't have at least 4 tab-separated columns are
 *  ignored — covers blank lines, partial appends, and the rare
 *  fail2ban variant that emits extra trailing fields. */
export const BLOCKLIST_LOG_PATH =
  process.env.FAIL2BAN_BLOCKLIST_PATH ?? "/var/log/fail2ban-blocklist.tsv";

/** The jail used to drive the nginx permaban list. Mirrors the filter
 *  in blocklist-tools.sh — only HTTP-tier jails belong on the
 *  `nginx deny` list; SSH bans are handled by the firewall. */
export const NGINX_PERMABAN_JAIL = "nginx-noscript";

/** Default for the rolling window used when computing nginx permaban
 *  candidates. Expressed in days so it lines up with how the operator
 *  reasons about repeat offenders. */
export const DEFAULT_PERMABAN_WINDOW_DAYS = 30;

/** Default ban-count threshold for permaban candidates. Matches the
 *  CLI default (`PERMABAN_THRESHOLD=3`). */
export const DEFAULT_PERMABAN_THRESHOLD = 3;

export interface BlocklistEntry {
  /** ISO timestamp string as the source TSV emits it. Kept as the
   *  raw string so the audit page can render exactly what the file
   *  contains; aggregations sort lexicographically (ISO-safe). */
  ts: string;
  ip: string;
  jail: string;
  reason: string;
}

export interface BlocklistReadResult {
  /** Absolute path of the source file (after env resolution). Useful
   *  for surfacing in error messages so the operator knows which
   *  file to chmod. */
  path: string;
  /** When `null`, the file doesn't exist or isn't readable; the UI
   *  shows a helpful permission hint instead of an empty table. */
  entries: BlocklistEntry[] | null;
  /** mtime / size when the file was readable — null otherwise. */
  mtime: string | null;
  size: number | null;
  /** Specific failure mode so the UI can render the right hint. */
  error: "missing" | "permission" | "io" | null;
}

/** Reads the entire blocklist log into memory. The TSV is small even
 *  on a busy site (a few KB per banned IP), so streaming would just
 *  add complexity. Returns a structured result rather than throwing
 *  so the page renders something useful even when the file isn't
 *  reachable — fail2ban may not have written anything yet, or the
 *  Next.js process may lack read permissions. */
export async function readBlocklistLog(): Promise<BlocklistReadResult> {
  let stat;
  try {
    stat = await fs.stat(BLOCKLIST_LOG_PATH);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        path: BLOCKLIST_LOG_PATH,
        entries: null,
        mtime: null,
        size: null,
        error: "missing",
      };
    }
    if (code === "EACCES" || code === "EPERM") {
      return {
        path: BLOCKLIST_LOG_PATH,
        entries: null,
        mtime: null,
        size: null,
        error: "permission",
      };
    }
    return {
      path: BLOCKLIST_LOG_PATH,
      entries: null,
      mtime: null,
      size: null,
      error: "io",
    };
  }

  let text: string;
  try {
    text = await fs.readFile(BLOCKLIST_LOG_PATH, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      return {
        path: BLOCKLIST_LOG_PATH,
        entries: null,
        mtime: stat.mtime.toISOString(),
        size: stat.size,
        error: "permission",
      };
    }
    return {
      path: BLOCKLIST_LOG_PATH,
      entries: null,
      mtime: stat.mtime.toISOString(),
      size: stat.size,
      error: "io",
    };
  }

  const entries: BlocklistEntry[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    const cols = line.split("\t");
    if (cols.length < 4) continue;
    entries.push({
      ts: cols[0]!,
      ip: cols[1]!,
      jail: cols[2]!,
      reason: cols.slice(3).join("\t"),
    });
  }

  return {
    path: BLOCKLIST_LOG_PATH,
    entries,
    mtime: stat.mtime.toISOString(),
    size: stat.size,
    error: null,
  };
}

export interface CountedKey {
  key: string;
  count: number;
}

function countBy<T>(values: readonly T[], pick: (v: T) => string): CountedKey[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const k = pick(v);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export interface BlocklistStats {
  totalBans: number;
  uniqueIps: number;
  uniqueJails: number;
  /** Earliest + latest timestamp seen in the log. null when empty. */
  firstTs: string | null;
  lastTs: string | null;
  /** Top 10 jails / IPs by ban count. Useful as the at-a-glance summary. */
  topJails: CountedKey[];
  topIps: CountedKey[];
}

export function computeStats(entries: readonly BlocklistEntry[]): BlocklistStats {
  if (entries.length === 0) {
    return {
      totalBans: 0,
      uniqueIps: 0,
      uniqueJails: 0,
      firstTs: null,
      lastTs: null,
      topJails: [],
      topIps: [],
    };
  }
  const ips = new Set<string>();
  const jails = new Set<string>();
  let firstTs = entries[0]!.ts;
  let lastTs = entries[0]!.ts;
  for (const e of entries) {
    ips.add(e.ip);
    jails.add(e.jail);
    if (e.ts < firstTs) firstTs = e.ts;
    if (e.ts > lastTs) lastTs = e.ts;
  }
  return {
    totalBans: entries.length,
    uniqueIps: ips.size,
    uniqueJails: jails.size,
    firstTs,
    lastTs,
    topJails: countBy(entries, (e) => e.jail).slice(0, 10),
    topIps: countBy(entries, (e) => e.ip).slice(0, 10),
  };
}

export interface IpAggregate {
  ip: string;
  count: number;
  /** First and last time we banned this IP — useful for sorting by
   *  recency and for spotting long-tail attackers. */
  firstSeen: string;
  lastSeen: string;
  /** Distinct jails that have banned this IP (sorted asc). */
  jails: string[];
}

/** Bucket every entry by IP. Sorted by ban count desc, then recency. */
export function aggregateByIp(
  entries: readonly BlocklistEntry[],
): IpAggregate[] {
  const buckets = new Map<
    string,
    { count: number; firstSeen: string; lastSeen: string; jails: Set<string> }
  >();
  for (const e of entries) {
    const cur = buckets.get(e.ip);
    if (cur) {
      cur.count += 1;
      if (e.ts < cur.firstSeen) cur.firstSeen = e.ts;
      if (e.ts > cur.lastSeen) cur.lastSeen = e.ts;
      cur.jails.add(e.jail);
    } else {
      buckets.set(e.ip, {
        count: 1,
        firstSeen: e.ts,
        lastSeen: e.ts,
        jails: new Set([e.jail]),
      });
    }
  }
  return [...buckets.entries()]
    .map(([ip, b]) => ({
      ip,
      count: b.count,
      firstSeen: b.firstSeen,
      lastSeen: b.lastSeen,
      jails: [...b.jails].sort((a, b) => a.localeCompare(b)),
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.lastSeen.localeCompare(a.lastSeen) ||
        a.ip.localeCompare(b.ip),
    );
}

export interface PermabanCandidate {
  ip: string;
  count: number;
  lastSeen: string;
}

export interface PermabanComputation {
  /** Cutoff timestamp (ISO) — entries older than this are ignored. */
  cutoff: string;
  thresholdDays: number;
  threshold: number;
  jail: string;
  candidates: PermabanCandidate[];
}

/** Mirrors the awk filter from blocklist-tools.sh `firewall-deny`: only
 *  HTTP-tier bans (jail = nginx-noscript by default) within the rolling
 *  window are counted, and we emit IPs at or above the threshold.
 *  Sorted ascending by IP so the resulting elements.nft diffs cleanly
 *  between regenerations. */
export function computePermabanCandidates(
  entries: readonly BlocklistEntry[],
  opts: {
    windowDays?: number;
    threshold?: number;
    jail?: string;
    /** Override "now" for tests/preview. Defaults to current wall clock. */
    now?: Date;
  } = {},
): PermabanComputation {
  const windowDays = opts.windowDays ?? DEFAULT_PERMABAN_WINDOW_DAYS;
  const threshold = opts.threshold ?? DEFAULT_PERMABAN_THRESHOLD;
  const jail = opts.jail ?? NGINX_PERMABAN_JAIL;
  const now = opts.now ?? new Date();
  const cutoffMs = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs).toISOString();

  const buckets = new Map<string, { count: number; lastSeen: string }>();
  for (const e of entries) {
    if (e.jail !== jail) continue;
    if (e.ts < cutoff) continue;
    const cur = buckets.get(e.ip);
    if (cur) {
      cur.count += 1;
      if (e.ts > cur.lastSeen) cur.lastSeen = e.ts;
    } else {
      buckets.set(e.ip, { count: 1, lastSeen: e.ts });
    }
  }

  const candidates: PermabanCandidate[] = [];
  for (const [ip, b] of buckets.entries()) {
    if (b.count >= threshold) {
      candidates.push({ ip, count: b.count, lastSeen: b.lastSeen });
    }
  }
  candidates.sort((a, b) => a.ip.localeCompare(b.ip));

  return {
    cutoff,
    thresholdDays: windowDays,
    threshold,
    jail,
    candidates,
  };
}

/** Generates the same `elements.nft` content that
 *  blocklist-tools.sh `firewall-deny` writes — the operator can download
 *  it from the admin UI, copy to the server, and `nft -f` it into
 *  /var/lib/permaban/elements.nft. The actual file install stays in
 *  Termius / blocklist-tools.sh; the webapp only previews.
 *
 *  Output formát:
 *    flush set inet permaban permaban_v4
 *    flush set inet permaban permaban_v6
 *    add element inet permaban permaban_v4 { 1.2.3.4 }
 *    add element inet permaban permaban_v6 { 2001:db8::1 }
 *
 *  flush + add v jednom souboru = atomická transakce při `nft -f`, žádné
 *  okénko, kdy by byl set prázdný. */
export function renderPermabanElementsConfig(
  result: PermabanComputation,
  options: {
    /** Source file path to embed in the header — usually the live
     *  log path so the operator can trace the data lineage. */
    sourcePath?: string;
    /** ISO timestamp of when this snapshot was generated. Defaults
     *  to now. Exposed so callers running in test mode can pin it. */
    generatedAt?: string;
  } = {},
): string {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const lines: string[] = [
    "# Auto-generated permaban elements pro nftables",
    `# Source: ${options.sourcePath ?? BLOCKLIST_LOG_PATH} (filter: jail=${result.jail})`,
    `# Generated: ${generatedAt}`,
    `# Threshold: IPs banned >= ${result.threshold}× in last ${result.thresholdDays} days`,
    "#",
    "flush set inet permaban permaban_v4",
    "flush set inet permaban permaban_v6",
  ];
  for (const c of result.candidates) {
    const family = c.ip.includes(":") ? "permaban_v6" : "permaban_v4";
    lines.push(`add element inet permaban ${family} { ${c.ip} }`);
  }
  // Trailing newline to keep the file POSIX-conformant and diff-friendly.
  return lines.join("\n") + "\n";
}

/** Writes the unique-IP table as TSV/CSV. We default to TSV because
 *  the source format already is, but CSV is offered for spreadsheet
 *  import. RFC-4180 quoting is overkill here (no commas in IPs or
 *  jails) but we still escape just in case a future jail name picks
 *  up a comma — better to spend 5 lines than risk a malformed export. */
export function renderIpsTable(
  rows: readonly IpAggregate[],
  format: "tsv" | "csv",
): string {
  const sep = format === "csv" ? "," : "\t";
  const escape =
    format === "csv"
      ? (v: string) =>
          /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
      : (v: string) => v.replace(/\t/g, " ");

  const header = ["ip", "ban_count", "first_seen", "last_seen", "jails"]
    .map(escape)
    .join(sep);
  const body = rows.map((r) =>
    [
      r.ip,
      String(r.count),
      r.firstSeen,
      r.lastSeen,
      r.jails.join("|"),
    ]
      .map(escape)
      .join(sep),
  );
  return [header, ...body].join("\n") + "\n";
}
