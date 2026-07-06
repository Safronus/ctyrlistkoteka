/**
 * Ping the running Next.js server's revalidation endpoint after a CLI sync,
 * so /statistiky and the home stat panels refresh immediately instead of
 * waiting out their revalidate window. Best-effort: never throws.
 *
 * The CLI runs outside the Next.js runtime and so can't call revalidateTag/
 * revalidatePath itself; it POSTs to the local server, which does. Skips
 * silently when `REVALIDATE_TOKEN` isn't set (dev / not configured yet).
 *
 * Self-contained (no `@/` imports): imported by scripts/sync.ts under tsx,
 * which must not pull in alias-using modules — same rule as indexnow.ts.
 */

export interface RevalidatePingResult {
  ok: boolean;
  status?: number;
  skipped?: string;
}

export async function pingRevalidate(): Promise<RevalidatePingResult> {
  const token = process.env.REVALIDATE_TOKEN;
  if (!token) return { ok: false, skipped: "no-token" };
  // Target the LOCAL server (same host as the sync), not the public origin:
  // this must bypass Nginx/SSL and hit Next directly. Override with
  // REVALIDATE_URL if the app doesn't listen on 127.0.0.1:$PORT.
  const url =
    process.env.REVALIDATE_URL ??
    `http://127.0.0.1:${process.env.PORT ?? "3000"}/api/admin/revalidate`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, skipped: "fetch-failed" };
  }
}
