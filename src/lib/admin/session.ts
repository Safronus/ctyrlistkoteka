import { cookies, headers } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { clientIpFromHeaders } from "@/lib/clientIp";

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
// Single source of truth for "is the configured password usable" —
// iron-session needs ≥32 chars; anything shorter (or missing) falls back
// to the PUBLIC dev key, which must never authenticate in production.
const hasStrongSessionPassword =
  !!sessionPassword && sessionPassword.length >= 32;

// Fail closed AT MODULE LOAD in production: this file is imported only by
// admin code (admin pages/layout, server actions, /api/admin routes — the
// public site never touches it), so throwing here bricks every admin entry
// point at once when the password is weak/missing. That closes the paths a
// per-function guard can't reach — e.g. a future handler calling
// getAdminSession() + isAuthenticated() directly and never hitting
// requireAuth(): its session would happily unseal against the public dev
// fallback key. On the VPS the build imports admin modules too, so a
// misconfigured .env surfaces as a RED deploy (integrity/health gates keep
// the running app serving) instead of a silently forgeable admin cookie.
if (process.env.NODE_ENV === "production" && !hasStrongSessionPassword) {
  throw new Error(
    "ADMIN_SESSION_PASSWORD must be set to at least 32 characters in production",
  );
}

/** 1-hour sliding session — long enough for a typical upload+sync run,
 *  short enough that a stolen cookie doesn't grant indefinite access.
 *  Refreshed on every authenticated request via touchSession(). */
export const SESSION_TTL_MS = 60 * 60 * 1000;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const sessionOptions: SessionOptions = {
  // The fallback below is dev-only, not a real credential: the
  // module-load guard above throws in production before this key could
  // ever seal a session there — hence the scoped lint disable.
  // eslint-disable-next-line sonarjs/no-hardcoded-passwords
  password: hasStrongSessionPassword
    ? sessionPassword! // guard above guarantees a ≥32-char string here
    : // Dev fallback — explicitly noisy: local dev keeps working without
      // env setup, while the module-load guard above makes production
      // refuse to boot the admin surface with this key in play.
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

/** Refuses to proceed unless the session is authenticated. The strong-
 *  password requirement is enforced by the module-load guard above (this
 *  code can only run in production if the password already passed it), so
 *  no per-call re-check is needed here. */
export async function requireAuth(): Promise<AdminSessionData> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    throw new Error("Unauthenticated");
  }
  await touchSession();
  return session;
}

/** Route-handler variant of requireAuth(): resolves to the session when
 *  authenticated, `null` otherwise — never throws for auth reasons. Route
 *  handlers want to answer an unauthenticated probe with a deliberate
 *  response (the cloak-matching 404, or blocklist-export's explicit 401)
 *  rather than let an exception bubble into a generic 500. Built ON
 *  requireAuth so it stays the single auth choke point: any future
 *  tightening there applies to route handlers automatically, and the
 *  sliding-TTL touch happens here too. */
export async function tryRequireAuth(): Promise<AdminSessionData | null> {
  try {
    return await requireAuth();
  } catch {
    return null;
  }
}

/** Returns the best-effort remote IP for audit logging. Resolution is
 *  spoofing-resistant (X-Real-IP first — Nginx overwrites it with the
 *  TCP peer; never the client-controlled first XFF element), see
 *  src/lib/clientIp.ts. Falls back to "unknown" to keep the audit row
 *  well-formed even when the headers are missing (local dev). */
export async function getRequestIp(): Promise<string> {
  const h = await headers();
  return clientIpFromHeaders(h) ?? "unknown";
}
