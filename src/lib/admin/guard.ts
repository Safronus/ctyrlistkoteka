import { redirect } from "next/navigation";
import { getAdminSession, isAuthenticated, touchSession } from "./session";
import { hasAnyCredential } from "./credentials";

/** Centralised auth gate for /admin/* pages. Redirects unauthenticated
 *  visitors to /admin/setup or /admin/login (depending on whether any
 *  passkey exists yet) and refreshes the sliding-window session for
 *  authenticated ones. Use at the top of every admin page server
 *  component — `await ensureAdminAuth()` before any data fetch. */
export async function ensureAdminAuth(): Promise<{ credentialLabel: string }> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    if (!(await hasAnyCredential())) redirect("/admin/setup");
    redirect("/admin/login");
  }
  await touchSession();
  return { credentialLabel: session.credentialLabel! };
}
