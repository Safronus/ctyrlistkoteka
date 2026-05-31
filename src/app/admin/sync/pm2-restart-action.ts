"use server";

import { spawn } from "node:child_process";
import { appendAudit } from "@/lib/admin/audit";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";

/** Name of the PM2 process. The deploy uses
 *  `ecosystem.config.cjs` → name: "ctyrlistkoteka". Hard-coded here
 *  so an admin button click can't accidentally take down a different
 *  process if the env ever ships with multiple PM2 apps. */
const PM2_PROCESS_NAME = "ctyrlistkoteka";

/** Small delay before `pm2 restart` fires inside the spawned shell.
 *  The restart will SIGINT the very worker handling this HTTP
 *  request — without the delay the response body never reaches the
 *  client, the browser shows a connection-reset blip, and the
 *  operator can't tell whether the click registered. The delay gives
 *  Next.js enough headroom to flush the action response back through
 *  Nginx before its own process dies. */
const RESTART_DELAY_SECONDS = 1;

/**
 * Triggers `pm2 restart ctyrlistkoteka` from the /admin/sync page.
 *
 * Spawn shape:
 *   - `detached: true` + `child.unref()` so the parent Node process
 *     can exit independently. The child outlives this action call.
 *   - `stdio: "ignore"` because we can't reliably read stdout from a
 *     process whose grandparent (PM2) is about to SIGINT us anyway.
 *   - Shell sleep before `pm2 restart` so the HTTP response flushes
 *     before the kill — see RESTART_DELAY_SECONDS.
 *
 * Audit is written BEFORE the spawn so the log entry survives the
 * impending restart. The audit file lives under data/.admin/ which
 * the new process re-opens on startup.
 *
 * Returns void so it slots straight into `<form action={...}>` —
 * same pattern as the other admin server actions in this project.
 */
export async function restartPm2(): Promise<void> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) return;
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  // Persist the audit before the spawn — the restart will kill this
  // very worker mid-flight, and an audit write that happens after
  // the spawn might never reach disk.
  await appendAudit({
    action: "pm2.restart",
    ip,
    credentialLabel,
    details: {
      process: PM2_PROCESS_NAME,
      via: "admin-sync-page",
    },
  });

  // Shell-level delay so `pm2 restart` fires AFTER this function
  // returns and Next.js flushes the action response. Both
  // `detached` and `unref()` are required for the child to outlive
  // the Node parent — without unref, the parent waits on the child
  // even though detached lets it form its own process group.
  const child = spawn(
    "sh",
    [
      "-c",
      `sleep ${RESTART_DELAY_SECONDS} && pm2 restart ${PM2_PROCESS_NAME}`,
    ],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
}
