import { promises as fs } from "node:fs";
import path from "node:path";
import { ADMIN_ROOTS } from "./paths";
import { ensureDir } from "./atomic";

const AUDIT_LOG_PATH = path.join(ADMIN_ROOTS.secure, "admin-audit.log");

export type AuditAction =
  | "auth.register"
  | "auth.login"
  | "auth.logout"
  | "auth.failed"
  | "file.upload"
  | "file.delete"
  | "file.replace"
  | "file.restore"
  | "json.update"
  | "sync.start"
  | "sync.finish"
  | "sync.fail";

export interface AuditEntry {
  action: AuditAction;
  /** Remote IP from x-forwarded-for / connection. Falls back to
   *  "unknown" — we still want the row even if the request came in
   *  via a misconfigured proxy. */
  ip: string;
  /** Credential label (passkey nickname) when authenticated, undefined
   *  for failed-auth rows. Single-user app, so this doubles as the
   *  identity field. */
  credentialLabel?: string;
  /** Free-form details — keep names ASCII, no PII beyond filenames
   *  and counts. Examples: { path: "data/finds/originals/123.heic",
   *  bytes: 4520123 }. */
  details?: Record<string, unknown>;
}

/** Append-only JSONL log of every admin mutation + auth event. The log
 *  lives outside the public document roots so even a misconfigured
 *  Nginx alias can't expose it. Best-effort — append failure logs to
 *  console but never throws upstream, so a disk-full audit failure
 *  doesn't take down the action that triggered it. */
export async function appendAudit(entry: AuditEntry): Promise<void> {
  try {
    await ensureDir(path.dirname(AUDIT_LOG_PATH));
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        ...entry,
      }) + "\n";
    await fs.appendFile(AUDIT_LOG_PATH, line, { encoding: "utf8" });
  } catch (err) {
    console.warn("[admin] audit log append failed", err);
  }
}

/** Tail the most recent N audit entries for the in-app activity view.
 *  Reads the whole file into memory — fine while the log stays under
 *  ~10 MB; rotate/truncate later if it grows. */
export async function readRecentAudit(
  limit = 50,
): Promise<Array<AuditEntry & { ts: string }>> {
  try {
    const text = await fs.readFile(AUDIT_LOG_PATH, "utf8");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const tail = lines.slice(-limit).reverse();
    return tail
      .map((l) => {
        try {
          return JSON.parse(l) as AuditEntry & { ts: string };
        } catch {
          return null;
        }
      })
      .filter((x): x is AuditEntry & { ts: string } => x !== null);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
