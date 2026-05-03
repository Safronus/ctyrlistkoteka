import { promises as fs } from "node:fs";
import type { BlocklistEntry } from "./blocklist";

/** State file written by deploy/abuseipdb-report.sh — one line, the
 *  ISO timestamp of the latest TSV row that was POSTed to the
 *  bulk-report endpoint. Anything older or equal in the TSV has been
 *  reported, anything newer is pending until the next cron tick. */
export const ABUSEIPDB_STATE_PATH =
  process.env.ABUSEIPDB_STATE_PATH ??
  "/var/lib/abuseipdb-report/last-timestamp";

/** Free-form output of the same script. Each successful run appends
 *  a "Reporting N bans" line and a "Saved=N Invalid=N NewState=ts"
 *  line; idle runs append "No new bans (since: ts)". */
export const ABUSEIPDB_LOG_PATH =
  process.env.ABUSEIPDB_LOG_PATH ?? "/var/log/abuseipdb-report.log";

const RESERVED_PATTERNS: RegExp[] = [
  /^192\.0\.2\./, // RFC 5737 TEST-NET-1
  /^198\.51\.100\./, // RFC 5737 TEST-NET-2
  /^203\.0\.113\./, // RFC 5737 TEST-NET-3
  /^2001:0?[Dd][Bb]8:/, // RFC 3849 IPv6 doc prefix
];

function isReservedIp(ip: string): boolean {
  return RESERVED_PATTERNS.some((re) => re.test(ip));
}

/** Mirrors the awk `categories(jail)` mapping in
 *  deploy/abuseipdb-report.sh so the admin UI can show what each IP
 *  was reported as without re-deriving the rule on the read path. */
export function jailToAbuseCategories(jail: string): string {
  if (jail === "sshd" || jail === "sshd-logger") return "18,22";
  if (jail === "nginx-noscript") return "19,21";
  return "15";
}

export const CATEGORY_LABEL_MAP: Readonly<Record<string, string>> = {
  "15": "Hacking",
  "18": "Brute-Force",
  "19": "Bad Web Bot",
  "21": "Web App Attack",
  "22": "SSH",
};

/** Turns "18,22" into "Brute-Force / SSH" — used in the reported-IP
 *  table so the operator doesn't have to memorise category numbers. */
export function describeCategories(csv: string): string {
  return csv
    .split(",")
    .map((c) => CATEGORY_LABEL_MAP[c.trim()] ?? c.trim())
    .filter(Boolean)
    .join(" / ");
}

export type AbuseIpdbFileError = "missing" | "permission" | "io";

interface ReadFileResult {
  content: string | null;
  error: AbuseIpdbFileError | null;
}

async function readFileSafe(path: string): Promise<ReadFileResult> {
  try {
    const content = await fs.readFile(path, "utf8");
    return { content, error: null };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return { content: null, error: "missing" };
    if (e.code === "EACCES") return { content: null, error: "permission" };
    return { content: null, error: "io" };
  }
}

/** One iso_ts-prefixed line from the report log, parsed into a
 *  structured record. The log mixes a few shapes:
 *    "<ts> Reporting <N> bans (since: <ts>)"
 *    "<ts> Saved=<N> Invalid=<N> NewState=<ts>"
 *    "<ts> No new bans (since: <ts>)"
 *    "<ts> AbuseIPDB API error: HTTP <code>"
 *  We surface them as "info" / "report" / "error" in the UI. */
export interface AbuseIpdbLogLine {
  ts: string;
  /** info = "No new bans" / unrecognised; report = parsed counts;
   *  error = HTTP / setup failure surfaced from stderr. */
  kind: "info" | "report" | "error";
  message: string;
  saved?: number;
  invalid?: number;
  reportedCount?: number;
  newState?: string;
}

const ISO_TS_PREFIX = /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[^ ]+)\s+(.*)$/;

function parseLogLine(raw: string): AbuseIpdbLogLine | null {
  const m = ISO_TS_PREFIX.exec(raw);
  if (!m) return null;
  const ts = m[1]!;
  const rest = m[2]!;

  // "AbuseIPDB API error: ..." or any line starting with the literal
  // word "Error" — surface as error.
  if (/^AbuseIPDB API error/i.test(rest) || /^error/i.test(rest)) {
    return { ts, kind: "error", message: rest };
  }

  // Reporting N bans (since: ts)
  const reporting = /^Reporting\s+(\d+)\s+bans/.exec(rest);
  if (reporting) {
    return {
      ts,
      kind: "info",
      message: rest,
      reportedCount: Number(reporting[1]),
    };
  }

  // Saved=N Invalid=N NewState=ts
  const saved = /^Saved=(\d+)\s+Invalid=(\d+)\s+NewState=(\S+)/.exec(rest);
  if (saved) {
    return {
      ts,
      kind: "report",
      message: rest,
      saved: Number(saved[1]),
      invalid: Number(saved[2]),
      newState: saved[3],
    };
  }

  return { ts, kind: "info", message: rest };
}

export interface AbuseIpdbReportedIp {
  ip: string;
  /** How many TSV rows reference this IP within the reported window. */
  count: number;
  firstSeen: string;
  lastSeen: string;
  jails: string[];
  /** AbuseIPDB category list as a CSV ("18,22"). */
  categories: string;
}

export interface AbuseIpdbSummary {
  statePath: string;
  logPath: string;
  /** Last ts the report script claims to have flushed. The state
   *  file is the authoritative source; when Next.js can't read it
   *  we fall back to the max `NewState=` recorded in the log file
   *  (these two should agree under normal operation). */
  lastTimestamp: string | null;
  /** Where the value above came from — useful for the operator to
   *  understand why a permission warning shouldn't break the panel
   *  when the log alone is enough to compute everything. */
  lastTimestampSource: "state" | "log" | null;
  /** Set when state file and log disagree by more than a tick. The
   *  most common cause is a stale log being rotated out under a
   *  fresh state — surface it for review rather than picking one
   *  silently. */
  lastTimestampMismatch: boolean;
  stateError: AbuseIpdbFileError | null;
  logError: AbuseIpdbFileError | null;
  /** Recent log lines, newest first. Capped at the call-site limit. */
  recentLog: AbuseIpdbLogLine[];
  /** Sum of `Saved=` across every "report"-kind line in the log. The
   *  number is approximate (it's the running total of API-side
   *  acceptances since the script first ran), and useful as a sanity
   *  check against the IP-aggregate count. */
  totalSaved: number;
  totalInvalid: number;
  /** Reported IPs (TSV rows with ts ≤ lastTimestamp, reserved IPs
   *  filtered out — same rule the shell script uses). Sorted by ban
   *  count desc, then by lastSeen desc. */
  reportedIps: AbuseIpdbReportedIp[];
  /** Number of TSV rows newer than lastTimestamp that would be
   *  reported on the next cron run (mirrors the `awk` filter). */
  pendingCount: number;
  pendingIps: AbuseIpdbReportedIp[];
}

interface BuildSummaryOptions {
  /** How many recent log lines to surface. The full log can grow
   *  unbounded, so we tail-read just enough to fill the page table. */
  recentLogLimit?: number;
}

/** Reads state + log files, then cross-references the TSV `entries`
 *  list (already loaded by readBlocklistLog) to produce an admin-
 *  ready summary of AbuseIPDB reporting status. */
export async function loadAbuseIpdbSummary(
  entries: readonly BlocklistEntry[],
  options: BuildSummaryOptions = {},
): Promise<AbuseIpdbSummary> {
  const limit = options.recentLogLimit ?? 30;

  const [stateRead, logRead] = await Promise.all([
    readFileSafe(ABUSEIPDB_STATE_PATH),
    readFileSafe(ABUSEIPDB_LOG_PATH),
  ]);

  let stateFileTimestamp: string | null = null;
  if (stateRead.content !== null) {
    const trimmed = stateRead.content.trim();
    if (trimmed.length > 0 && /T/.test(trimmed)) {
      stateFileTimestamp = trimmed;
    }
  }

  const recentLog: AbuseIpdbLogLine[] = [];
  let totalSaved = 0;
  let totalInvalid = 0;
  let logMaxNewState: string | null = null;
  if (logRead.content !== null) {
    const lines = logRead.content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    for (const raw of lines) {
      const parsed = parseLogLine(raw);
      if (!parsed) continue;
      if (parsed.kind === "report") {
        if (typeof parsed.saved === "number") totalSaved += parsed.saved;
        if (typeof parsed.invalid === "number") totalInvalid += parsed.invalid;
        if (
          typeof parsed.newState === "string" &&
          (logMaxNewState === null || parsed.newState > logMaxNewState)
        ) {
          logMaxNewState = parsed.newState;
        }
      }
      recentLog.push(parsed);
    }
  }

  // Pick the most reliable source for the cross-reference cutoff.
  // state file wins when it's readable; the log's NewState= column
  // is the same value the script wrote there, so it's a safe fallback
  // when the state file is locked behind 700 perms (the script
  // chmods the dir to 700 — the operator may not have ACL'd it for
  // Next.js, but the log is usually 644).
  let lastTimestamp: string | null = null;
  let lastTimestampSource: "state" | "log" | null = null;
  if (stateFileTimestamp !== null) {
    lastTimestamp = stateFileTimestamp;
    lastTimestampSource = "state";
  } else if (logMaxNewState !== null) {
    lastTimestamp = logMaxNewState;
    lastTimestampSource = "log";
  }
  const lastTimestampMismatch =
    stateFileTimestamp !== null &&
    logMaxNewState !== null &&
    stateFileTimestamp !== logMaxNewState;

  const reportedAggregate = aggregateReportable(
    entries,
    lastTimestamp,
    /*reportedSide*/ true,
  );
  const pendingAggregate = aggregateReportable(
    entries,
    lastTimestamp,
    /*reportedSide*/ false,
  );

  return {
    statePath: ABUSEIPDB_STATE_PATH,
    logPath: ABUSEIPDB_LOG_PATH,
    lastTimestamp,
    lastTimestampSource,
    lastTimestampMismatch,
    stateError: stateRead.error,
    logError: logRead.error,
    recentLog: recentLog.slice(-limit).reverse(),
    totalSaved,
    totalInvalid,
    reportedIps: reportedAggregate,
    pendingCount: pendingAggregate.reduce((acc, ip) => acc + ip.count, 0),
    pendingIps: pendingAggregate,
  };
}

/** Folds the TSV entries on the same side of `lastTimestamp` (≤ for
 *  reported, > for pending). Reserved IPs (RFC 5737 / RFC 3849) are
 *  dropped because the shell script never POSTs them — keeping the
 *  page count consistent with what the API actually saw. */
function aggregateReportable(
  entries: readonly BlocklistEntry[],
  lastTimestamp: string | null,
  reportedSide: boolean,
): AbuseIpdbReportedIp[] {
  const byIp = new Map<
    string,
    { count: number; firstSeen: string; lastSeen: string; jails: Set<string> }
  >();
  for (const e of entries) {
    if (isReservedIp(e.ip)) continue;
    const isReported =
      lastTimestamp !== null && e.ts <= lastTimestamp;
    if (reportedSide && !isReported) continue;
    if (!reportedSide && isReported) continue;
    if (!reportedSide && lastTimestamp === null) {
      // No state yet → everything in TSV is pending.
    }
    const cur = byIp.get(e.ip);
    if (cur) {
      cur.count += 1;
      if (e.ts < cur.firstSeen) cur.firstSeen = e.ts;
      if (e.ts > cur.lastSeen) cur.lastSeen = e.ts;
      cur.jails.add(e.jail);
    } else {
      byIp.set(e.ip, {
        count: 1,
        firstSeen: e.ts,
        lastSeen: e.ts,
        jails: new Set([e.jail]),
      });
    }
  }
  const out: AbuseIpdbReportedIp[] = [];
  for (const [ip, agg] of byIp) {
    const jails = [...agg.jails].sort();
    // The shell script picks the FIRST jail when forming the AbuseIPDB
    // category set (per CSV row). Aggregating across multiple bans we
    // don't know which jail "won" for each row, so we union the
    // category sets — that's what the operator effectively reported
    // about this IP across all rows. Numeric-sort + dedupe keeps the
    // CSV stable.
    const cats = new Set<string>();
    for (const j of jails) {
      for (const c of jailToAbuseCategories(j).split(",")) cats.add(c.trim());
    }
    const categoriesCsv = [...cats]
      .sort((a, b) => Number(a) - Number(b))
      .join(",");
    out.push({
      ip,
      count: agg.count,
      firstSeen: agg.firstSeen,
      lastSeen: agg.lastSeen,
      jails,
      categories: categoriesCsv,
    });
  }
  out.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.lastSeen < b.lastSeen ? 1 : -1;
  });
  return out;
}
