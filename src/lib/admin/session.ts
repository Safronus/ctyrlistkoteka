import { cookies, headers } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";

export interface AdminSessionData {
  /** Set on successful authentication; absent means anonymous. The
   *  label identifies which credential authenticated (single-user
   *  app, but each device has its own passkey, so the label is the
   *  human nickname for that device). */
  credentialLabel?: string;
  /** Issued-at unix ms. Used for sliding-window expiry — refreshed
   *  on every authenticated request. */
  iat?: number;
  /** Pending registration challenge (base64url). Cleared on success or
   *  abandoned after CHALLENGE_TTL_MS. Stored on the session itself so
   *  the verify step can match it without a server-side store. */
  pendingRegistrationChallenge?: string;
  pendingRegistrationLabel?: string;
  /** Pending login challenge (base64url). Same lifecycle as the
   *  registration variant above. */
  pendingLoginChallenge?: string;
}

const sessionPassword = process.env.ADMIN_SESSION_PASSWORD;

/** 1-hour sliding session — long enough for a typical upload+sync run,
 *  short enough that a stolen cookie doesn't grant indefinite access.
 *  Refreshed on every authenticated request via touchSession(). */
export const SESSION_TTL_MS = 60 * 60 * 1000;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const sessionOptions: SessionOptions = {
  password:
    sessionPassword && sessionPassword.length >= 32
      ? sessionPassword
      : // Dev fallback — explicitly noisy so misconfig in prod fails
        // closed (the session is never readable by a real user but
        // login still works for local development). The check in
        // requireAuth() will refuse to authenticate when the env var
        // is missing in production.
        "dev-only-fallback-do-not-use-in-prod-aaaaaaaaaaaaaaaa",
  cookieName: "ctyr_admin",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  },
};

export async function getAdminSession() {
  const cookieStore = await cookies();
  return getIronSession<AdminSessionData>(cookieStore, sessionOptions);
}

/** True when the session has a credentialLabel and isn't past its
 *  sliding TTL. Use this in route guards / server actions before any
 *  data-modifying operation. */
export function isAuthenticated(s: AdminSessionData): boolean {
  if (!s.credentialLabel || !s.iat) return false;
  return Date.now() - s.iat < SESSION_TTL_MS;
}

/** Refreshes `iat` so the next request keeps the session alive. Call
 *  this at the top of any authenticated handler. */
export async function touchSession(): Promise<void> {
  const session = await getAdminSession();
  if (session.credentialLabel) {
    session.iat = Date.now();
    await session.save();
  }
}

/** Refuses to proceed unless the session is authenticated AND the
 *  production session-password env var is present. The password
 *  guard is a belt-and-braces check — without it, sessions would be
 *  encrypted with the dev fallback key and trivially forgeable. */
export async function requireAuth(): Promise<AdminSessionData> {
  if (process.env.NODE_ENV === "production" && !sessionPassword) {
    throw new Error(
      "ADMIN_SESSION_PASSWORD is required in production",
    );
  }
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    throw new Error("Unauthenticated");
  }
  await touchSession();
  return session;
}

/** Returns the best-effort remote IP for audit logging. Trusts the
 *  X-Forwarded-For chain because requests reach Next.js exclusively
 *  through Nginx — set up to add the header. Falls back to "unknown"
 *  to keep the audit row well-formed even when the chain is missing. */
export async function getRequestIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "unknown";
}
