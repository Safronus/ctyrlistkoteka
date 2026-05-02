import { promises as fs } from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import {
  aggregateByIp,
  BLOCKLIST_LOG_PATH,
  computePermabanCandidates,
  DEFAULT_PERMABAN_THRESHOLD,
  DEFAULT_PERMABAN_WINDOW_DAYS,
  NGINX_PERMABAN_JAIL,
  readBlocklistLog,
  renderIpsTable,
  renderNginxDenyConfig,
} from "@/lib/admin/blocklist";
import {
  getAdminSession,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Exports for the blocklist admin page. Streams the source TSV when
 *  `kind=raw`, computes derived views (`ips`, `permaban`) otherwise.
 *  Auth-gated like every other /api/admin/* route — failure renders
 *  as a 404 to avoid disclosing the endpoint to unauthenticated
 *  scanners. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return new NextResponse("Not found", { status: 404 });
  }
  await touchSession();

  const sp = request.nextUrl.searchParams;
  const kind = sp.get("kind") ?? "raw";

  if (kind === "raw") {
    let raw: string;
    try {
      raw = await fs.readFile(BLOCKLIST_LOG_PATH, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const status =
        code === "ENOENT" ? 404 : code === "EACCES" || code === "EPERM" ? 403 : 500;
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
    return new NextResponse(raw, {
      status: 200,
      headers: {
        "content-type": "text/tab-separated-values; charset=utf-8",
        "content-disposition": `attachment; filename="fail2ban-blocklist-${dateStamp()}.tsv"`,
        "cache-control": "no-store",
      },
    });
  }

  const data = await readBlocklistLog();
  if (!data.entries) {
    return NextResponse.json(
      { error: data.error, path: data.path },
      {
        status: data.error === "missing" ? 404 : data.error === "permission" ? 403 : 500,
      },
    );
  }

  if (kind === "ips") {
    const format = (sp.get("format") ?? "tsv") as "tsv" | "csv" | "json";
    const aggregates = aggregateByIp(data.entries);
    if (format === "json") {
      return NextResponse.json(aggregates, {
        headers: {
          "content-disposition": `attachment; filename="blocklist-ips-${dateStamp()}.json"`,
          "cache-control": "no-store",
        },
      });
    }
    const body = renderIpsTable(aggregates, format);
    return new NextResponse(body, {
      headers: {
        "content-type":
          format === "csv"
            ? "text/csv; charset=utf-8"
            : "text/tab-separated-values; charset=utf-8",
        "content-disposition": `attachment; filename="blocklist-ips-${dateStamp()}.${format}"`,
        "cache-control": "no-store",
      },
    });
  }

  if (kind === "permaban") {
    const threshold = parsePositiveInt(
      sp.get("threshold"),
      DEFAULT_PERMABAN_THRESHOLD,
    );
    const windowDays = parsePositiveInt(
      sp.get("window"),
      DEFAULT_PERMABAN_WINDOW_DAYS,
    );
    const jail = sp.get("jail") ?? NGINX_PERMABAN_JAIL;
    const result = computePermabanCandidates(data.entries, {
      threshold,
      windowDays,
      jail,
    });
    const body = renderNginxDenyConfig(result, { sourcePath: data.path });
    return new NextResponse(body, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="permaban-list-${dateStamp()}.conf"`,
        "cache-control": "no-store",
      },
    });
  }

  return NextResponse.json({ error: "unknown_kind" }, { status: 400 });
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function dateStamp(): string {
  // ISO-like, filename-safe — `2026-05-02T232400` rather than the
  // colon-laden default. Avoids browsers rewriting the filename
  // (Safari trims after `:`).
  return new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
}
