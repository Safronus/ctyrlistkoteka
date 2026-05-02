import { redirect } from "next/navigation";
import { getAdminSession, isAuthenticated } from "./session";
import { hasAnyCredential } from "./credentials";

/** Centralised auth gate for /admin/* pages. Redirects unauthenticated
 *  visitors to /admin/setup or /admin/login (depending on whether any
 *  passkey exists yet). Use at the top of every admin page server
 *  component — `await ensureAdminAuth()` before any data fetch.
 *
 *  Note: this does NOT extend the session TTL. Next.js 15 forbids
 *  cookie writes from server components (`cookies().set()` throws
 *  "Cookies can only be modified in a Server Action or Route
 *  Handler"), and iron-session's `session.save()` is exactly that.
 *  The session refreshes whenever a server action runs (login,
 *  logout, future upload actions) — that's enough for the typical
 *  admin workflow which always involves at least one mutation. */
export async function ensureAdminAuth(): Promise<{ credentialLabel: string }> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    if (!(await hasAnyCredential())) redirect("/admin/setup");
    redirect("/admin/login");
  }
  return { credentialLabel: session.credentialLabel! };
}
