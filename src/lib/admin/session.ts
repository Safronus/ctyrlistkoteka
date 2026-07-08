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
// Single source of truth for "is the configured password usable", shared by
// the cookie-encryption key below and the requireAuth() guard so the two
// can't drift. iron-session needs ≥32 chars; anything shorter (or missing)
// falls back to the PUBLIC dev key, which must never authenticate in prod.
const hasStrongSessionPassword =
  !!sessionPassword && sessionPassword.length >= 32;

/** 1-hour sliding session — long enough for a typical upload+sync run,
 *  short enough that a stolen cookie doesn't grant indefinite access.
 *  Refreshed on every authenticated request via touchSession(). */
export const SESSION_TTL_MS = 60 * 60 * 1000;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const sessionOptions: SessionOptions = {
  password: hasStrongSessionPassword
    ? sessionPassword! // guard above guarantees a ≥32-char string here
    : // Dev fallback — explicitly noisy so misconfig in prod fails
      // closed (the session is never readable by a real user but
      // login still works for local development). requireAuth() refuses
      // to authenticate in production whenever this fallback is in play
      // (env var missing OR shorter than 32 chars).
      "dev-only-fallback-do-not-use-in-prod-aaaaaaaaaaaaaaaa",
  cookieName: "ctyr_admin",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    // Path "/" instead of "/admin" because the auth-gated download
    // endpoint lives under /api/admin/file — a `/admin`-scoped cookie
    // wouldn't be sent there, so the route would 404 every image
    // request even with a valid session. The cookie is HttpOnly,
    // Secure, SameSite=Strict and the body is iron-session encrypted,
    // so being readable on public routes (where it's ignored) carries
    // no practical risk.
    path: "/",
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

/** Refuses to proceed unless the session is authenticated AND a *strong*
 *  production session password is configured. The password guard is a
 *  belt-and-braces check — without it, sessions encrypted with the public
 *  dev fallback key (used whenever the env var is missing OR shorter than
 *  32 chars) would be trivially forgeable. Checks the SAME condition the
 *  cookie key uses, so a too-short password fails closed instead of
 *  silently authenticating against the public key. */
export async function requireAuth(): Promise<AdminSessionData> {
  if (process.env.NODE_ENV === "production" && !hasStrongSessionPassword) {
    throw new Error(
      "ADMIN_SESSION_PASSWORD must be set to at least 32 characters in production",
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
