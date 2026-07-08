import { promises as fs } from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import {
  aggregateByIp,
  BLOCKLIST_LOG_PATH,
  type BlocklistEntry,
  computePermabanCandidates,
  DEFAULT_PERMABAN_THRESHOLD,
  DEFAULT_PERMABAN_WINDOW_DAYS,
  NGINX_PERMABAN_JAIL,
  readBlocklistLog,
  renderIpsTable,
  renderPermabanElementsConfig,
} from "@/lib/admin/blocklist";
import { loadAbuseIpdbSummary } from "@/lib/admin/abuseipdb";
import { loadPermabanSnapshot } from "@/lib/admin/permaban";
import { tryRequireAuth } from "@/lib/admin/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Exports for the blocklist admin page. Streams the source TSV when
 *  `kind=raw`, computes derived views (`ips`, `permaban`, `recent`,
 *  `denied`, `whitelist`, `abuseipdb`) otherwise. Auth-gated like every
 *  other /api/admin/* route — auth failure renders as a 404 to avoid
 *  disclosing the endpoint to unauthenticated scanners. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // tryRequireAuth also refreshes the sliding TTL — no separate
  // touchSession() call needed.
  const session = await tryRequireAuth();
  if (!session) {
    // 404, matching every other /api/admin/* route. This used to be a
    // 401 "so a save-as makes the cause obvious", justified by a claim
    // that Nginx cloaks the route from scanners — but /api/admin/* is
    // matched by the `location /api/` block, NOT the IP-allowlisted
    // `location /admin`, so the 401 actually reached the open internet
    // and disclosed the endpoint's existence. Cloak-matching 404 it is.
    return new NextResponse("Not found", { status: 404 });
  }

  const sp = request.nextUrl.searchParams;
  const kind = sp.get("kind") ?? "raw";

  if (kind === "raw") {
    return await streamRaw();
  }

  if (kind === "denied") {
    return await exportDeniedIps(sp);
  }

  if (kind === "whitelist") {
    return await exportWhitelist(sp);
  }

  if (kind === "abuseipdb") {
    return await exportAbuseIpdbReports(sp);
  }

  // Everything past this point needs the parsed log.
  const data = await readBlocklistLog();
  if (!data.entries) {
    return NextResponse.json(
      { error: data.error, path: data.path },
      {
        status:
          data.error === "missing"
            ? 404
            : data.error === "permission"
              ? 403
              : 500,
      },
    );
  }

  if (kind === "ips") {
    return exportIps(data.entries, sp);
  }

  if (kind === "recent") {
    return exportRecent(data.entries, sp);
  }

  if (kind === "permaban") {
    return exportPermaban(data.entries, data.path, sp);
  }

  return NextResponse.json({ error: "unknown_kind" }, { status: 400 });
}

async function streamRaw(): Promise<NextResponse> {
  let raw: string;
  try {
    raw = await fs.readFile(BLOCKLIST_LOG_PATH, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const status =
      code === "ENOENT"
        ? 404
        : code === "EACCES" || code === "EPERM"
          ? 403
          : 500;
    return NextResponse.json(
      {
        error:
          code === "ENOENT"
            ? "log_missing"
            : code === "EACCES" || code === "EPERM"
              ? "permission_denied"
              : "io_error",
        path: BLOCKLIST_LOG_PATH,
      },
      { status },
    );
  }
  // Empty source files are valid — fail2ban hasn't banned anyone yet.
  // We surface that explicitly with a single header line so the
  // downloaded file isn't a confusingly blank document; the line is a
  // TSV comment-style hint rather than data and won't confuse downstream
  // tools that filter `^\d`.
  const body =
    raw.length === 0
      ? `# fail2ban-blocklist.tsv at ${BLOCKLIST_LOG_PATH} is empty (no bans logged yet).\n`
      : raw;
  return new NextResponse(body, {
    status: 200,
    headers: tsvHeaders(`fail2ban-blocklist-${dateStamp()}.tsv`, raw.length),
  });
}

function exportIps(
  entries: readonly BlocklistEntry[],
  sp: URLSearchParams,
): NextResponse {
  const format = (sp.get("format") ?? "tsv") as "tsv" | "csv" | "json";
  const aggregates = aggregateByIp(entries);
  if (format === "json") {
    return new NextResponse(JSON.stringify(aggregates, null, 2) + "\n", {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="blocklist-ips-${dateStamp()}.json"`,
        "cache-control": "no-store",
        "x-row-count": String(aggregates.length),
      },
    });
  }
  const body = renderIpsTable(aggregates, format);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type":
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "text/tab-separated-values; charset=utf-8",
      "content-disposition": `attachment; filename="blocklist-ips-${dateStamp()}.${format}"`,
      "cache-control": "no-store",
      "x-row-count": String(aggregates.length),
    },
  });
}

function exportRecent(
  entries: readonly BlocklistEntry[],
  sp: URLSearchParams,
): NextResponse {
  const format = (sp.get("format") ?? "tsv") as "tsv" | "csv" | "json";
  // Mirror the page's "newest first" presentation — the visible list
  // sorts most recent at the top, and operators dragging this into a
  // spreadsheet expect the same order.
  const limit = parseLimit(sp.get("limit"), 0); // 0 = no limit
  const ordered = [...entries].sort((a, b) => b.ts.localeCompare(a.ts));
  const sliced = limit > 0 ? ordered.slice(0, limit) : ordered;

  if (format === "json") {
    return new NextResponse(JSON.stringify(sliced, null, 2) + "\n", {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="blocklist-recent-${dateStamp()}.json"`,
        "cache-control": "no-store",
        "x-row-count": String(sliced.length),
      },
    });
  }

  const sep = format === "csv" ? "," : "\t";
  const escape =
    format === "csv"
      ? (v: string) =>
          /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
      : (v: string) => v.replace(/\t/g, " ").replace(/\n|\r/g, " ");
  const header = ["ts", "ip", "jail", "reason"].map(escape).join(sep);
  const rows = sliced
    .map((e) => [e.ts, e.ip, e.jail, e.reason].map(escape).join(sep))
    .join("\n");
  const body = header + "\n" + rows + (rows.length > 0 ? "\n" : "");
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type":
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "text/tab-separated-values; charset=utf-8",
      "content-disposition": `attachment; filename="blocklist-recent-${dateStamp()}.${format}"`,
      "cache-control": "no-store",
      "x-row-count": String(sliced.length),
    },
  });
}

function exportPermaban(
  entries: readonly BlocklistEntry[],
  sourcePath: string,
  sp: URLSearchParams,
): NextResponse {
  const threshold = parsePositiveInt(
    sp.get("threshold"),
    DEFAULT_PERMABAN_THRESHOLD,
  );
  const windowDays = parsePositiveInt(
    sp.get("window"),
    DEFAULT_PERMABAN_WINDOW_DAYS,
  );
  const jail = sp.get("jail") ?? NGINX_PERMABAN_JAIL;
  const result = computePermabanCandidates(entries, {
    threshold,
    windowDays,
    jail,
  });
  const body = renderPermabanElementsConfig(result, { sourcePath });
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="permaban-elements-${dateStamp()}.nft"`,
      "cache-control": "no-store",
      "x-row-count": String(result.candidates.length),
    },
  });
}

async function exportDeniedIps(sp: URLSearchParams): Promise<NextResponse> {
  const snapshot = await loadPermabanSnapshot();
  if (snapshot.firewall.error !== null) {
    return NextResponse.json(
      {
        error: snapshot.firewall.error,
        path: snapshot.paths.elements,
      },
      {
        status:
          snapshot.firewall.error === "missing"
            ? 404
            : snapshot.firewall.error === "permission"
              ? 403
              : 500,
      },
    );
  }
  const ips = snapshot.firewall.permabanedIps;
  const format = (sp.get("format") ?? "txt") as "txt" | "json" | "csv";
  if (format === "json") {
    return new NextResponse(JSON.stringify(ips, null, 2) + "\n", {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="permaban-denied-${dateStamp()}.json"`,
        "cache-control": "no-store",
        "x-row-count": String(ips.length),
      },
    });
  }
  if (format === "csv") {
    const body = "ip\n" + ips.join("\n") + (ips.length > 0 ? "\n" : "");
    return new NextResponse(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="permaban-denied-${dateStamp()}.csv"`,
        "cache-control": "no-store",
        "x-row-count": String(ips.length),
      },
    });
  }
  // txt — one IP per line. Co-incidentně to je formát, který nftables
  // očekává v `nft add element inet permaban permaban_v4 { 1.2.3.4 }`
  // po stripnutí wrapperu — uživatel ho ale typicky generuje přes
  // /api/admin/blocklist/export?kind=permaban (formát .nft).
  const body = ips.join("\n") + (ips.length > 0 ? "\n" : "");
  return new NextResponse(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="permaban-denied-${dateStamp()}.txt"`,
      "cache-control": "no-store",
      "x-row-count": String(ips.length),
    },
  });
}

async function exportWhitelist(sp: URLSearchParams): Promise<NextResponse> {
  const snapshot = await loadPermabanSnapshot();
  if (snapshot.whitelist.error !== null) {
    return NextResponse.json(
      {
        error: snapshot.whitelist.error,
        path: snapshot.paths.whitelist,
      },
      // status mapping is the same for whitelist as for elements file;
      // keep it inline for clarity rather than extracting a helper.
      {
        status:
          snapshot.whitelist.error === "missing"
            ? 404
            : snapshot.whitelist.error === "permission"
              ? 403
              : 500,
      },
    );
  }
  const ips = snapshot.whitelist.ips;
  const format = (sp.get("format") ?? "txt") as "txt" | "json";
  if (format === "json") {
    return new NextResponse(JSON.stringify(ips, null, 2) + "\n", {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="permaban-whitelist-${dateStamp()}.json"`,
        "cache-control": "no-store",
        "x-row-count": String(ips.length),
      },
    });
  }
  const body = ips.join("\n") + (ips.length > 0 ? "\n" : "");
  return new NextResponse(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="permaban-whitelist-${dateStamp()}.txt"`,
      "cache-control": "no-store",
      "x-row-count": String(ips.length),
    },
  });
}

async function exportAbuseIpdbReports(
  sp: URLSearchParams,
): Promise<NextResponse> {
  // Reuse the page's loader so the export reflects exactly what the
  // operator sees — same TS cutoff, same per-IP categories, same
  // dedup rules.
  const data = await readBlocklistLog();
  if (!data.entries) {
    return NextResponse.json(
      { error: data.error, path: data.path },
      {
        status:
          data.error === "missing"
            ? 404
            : data.error === "permission"
              ? 403
              : 500,
      },
    );
  }
  const summary = await loadAbuseIpdbSummary(data.entries);
  const format = (sp.get("format") ?? "tsv") as "tsv" | "csv" | "json";
  const rows = summary.reportedIps;
  if (format === "json") {
    return new NextResponse(JSON.stringify(rows, null, 2) + "\n", {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="abuseipdb-reports-${dateStamp()}.json"`,
        "cache-control": "no-store",
        "x-row-count": String(rows.length),
      },
    });
  }
  const sep = format === "csv" ? "," : "\t";
  const escape =
    format === "csv"
      ? (v: string) =>
          /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
      : (v: string) => v.replace(/\t/g, " ").replace(/\n|\r/g, " ");
  const header = [
    "ip",
    "ban_count",
    "first_seen",
    "last_seen",
    "jails",
    "abuse_categories",
  ]
    .map(escape)
    .join(sep);
  const body =
    header +
    "\n" +
    rows
      .map((r) =>
        [
          r.ip,
          String(r.count),
          r.firstSeen,
          r.lastSeen,
          r.jails.join("|"),
          r.categories,
        ]
          .map(escape)
          .join(sep),
      )
      .join("\n") +
    (rows.length > 0 ? "\n" : "");
  return new NextResponse(body, {
    headers: {
      "content-type":
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "text/tab-separated-values; charset=utf-8",
      "content-disposition": `attachment; filename="abuseipdb-reports-${dateStamp()}.${format}"`,
      "cache-control": "no-store",
      "x-row-count": String(rows.length),
    },
  });
}

function tsvHeaders(filename: string, sourceLength: number): HeadersInit {
  return {
    "content-type": "text/tab-separated-values; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store",
    "x-source-bytes": String(sourceLength),
  };
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseLimit(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function dateStamp(): string {
  // ISO-like, filename-safe — `2026-05-02T232400` rather than the
  // colon-laden default. Avoids browsers rewriting the filename
  // (Safari trims after `:`).
  return new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
}
