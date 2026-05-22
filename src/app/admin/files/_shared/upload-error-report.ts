/**
 * Shared error-report capture for the finds + crops upload forms.
 *
 * The forms POST multipart batches to /admin/api/upload/{scope}; when
 * one of those calls fails (network drop, 413 from upstream proxy,
 * Next.js error page instead of JSON, transient 500), the operator
 * sees a short banner — but the actual cause is buried in browser
 * DevTools at best. This module gives the form a structured place to
 * stash everything we know about the failure, plus a formatter that
 * produces a human-readable text dump for the operator to paste back
 * to whoever's debugging (Claude / a teammate).
 *
 * Pure module — no React, no DOM. Lives next to the shared upload
 * client code so both scope-specific forms can reuse it.
 */

export interface UploadErrorContext {
  /** ISO timestamp captured at error time. */
  ts: string;
  /** Which upload endpoint failed. */
  scope: "finds" | "crops";
  /** Zero-based batch index + total count, when known. Top-level
   *  pre-batch failures (auth, big-file rejection) omit these. */
  batchIndex?: number;
  totalBatches?: number;
  /** Files that were uploading in the failed batch. */
  files: Array<{
    name: string;
    size: number;
    /** Per-file reason from the server response, when one was returned. */
    reason?: string;
  }>;
  /** HTTP status from the fetch response. Absent when the fetch
   *  itself never reached the server (network drop, CORS, abort). */
  httpStatus?: number;
  httpStatusText?: string;
  /** Truncated response body — useful when the server returned an
   *  HTML error page (Next.js default) instead of our structured
   *  JSON. Capped at ~10kB so DevTools paste doesn't choke. */
  responseBody?: string;
  /** Top-level error string from UploadResponse.error, when the
   *  request reached the server and parsed cleanly. */
  serverError?: string;
  /** JS Error.message from the fetch catch branch, when fetch itself
   *  threw (network unreachable, abort, malformed URL). */
  networkError?: string;
  /** Browser user-agent — helpful when reproducing across browsers. */
  userAgent: string;
}

const BODY_TRUNCATE_BYTES = 10_000;

/** Read the response body as text, capped at BODY_TRUNCATE_BYTES.
 *  Used when JSON parse fails — common Next.js failure mode is
 *  returning an HTML error page (`<html>...500 Internal Server Error...`).
 *  Returns undefined on read failure so the caller's fallback logic
 *  is the same as "no body". */
export async function readBodyTruncated(
  response: Response,
): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (text.length <= BODY_TRUNCATE_BYTES) return text;
    return (
      text.slice(0, BODY_TRUNCATE_BYTES) +
      `\n…[truncated, total ${text.length} chars]`
    );
  } catch {
    return undefined;
  }
}

/** Formats the captured context as a multi-line text report ready to
 *  copy + paste. Czech labels because the operator works in Czech;
 *  technical fields stay English (HTTP, batch, etc.) for clarity. */
export function formatErrorReport(ctx: UploadErrorContext): string {
  const lines: string[] = [];
  lines.push("=== Upload Error Report ===");
  lines.push(`Time:       ${ctx.ts}`);
  lines.push(`Scope:      ${ctx.scope}`);
  if (ctx.batchIndex !== undefined && ctx.totalBatches !== undefined) {
    lines.push(`Batch:      ${ctx.batchIndex + 1} / ${ctx.totalBatches}`);
  }
  if (ctx.httpStatus !== undefined) {
    lines.push(
      `HTTP:       ${ctx.httpStatus}${
        ctx.httpStatusText ? " " + ctx.httpStatusText : ""
      }`,
    );
  }
  if (ctx.serverError) {
    lines.push(`Server err: ${ctx.serverError}`);
  }
  if (ctx.networkError) {
    lines.push(`Network err: ${ctx.networkError}`);
  }
  if (ctx.responseBody !== undefined && ctx.responseBody.length > 0) {
    lines.push("");
    lines.push(`--- Response body (${ctx.responseBody.length} chars) ---`);
    lines.push(ctx.responseBody);
    lines.push(`--- end body ---`);
  }
  lines.push("");
  lines.push(`Failed files (${ctx.files.length}):`);
  for (const f of ctx.files) {
    const sz = formatSize(f.size);
    lines.push(`  - ${f.name} (${sz})${f.reason ? " — " + f.reason : ""}`);
  }
  lines.push("");
  lines.push(`User agent: ${ctx.userAgent}`);
  return lines.join("\n");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
