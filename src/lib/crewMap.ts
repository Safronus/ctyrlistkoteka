import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { printableSiteUrl } from "@/lib/printableSiteUrl";

/**
 * The read-only crew map (`/tym/<token>`).
 *
 * One area of a "darování ve světě" wave, on a map, for the people who are
 * actually out there hiding the cards. It is the ONE place where hiding
 * coordinates leave the admin, and CLAUDE.md §6 is unambiguous that they
 * must not reach a public route — so this is not a public route in any
 * useful sense:
 *
 *   • the URL carries 144 bits of randomness and is not linked anywhere,
 *   • the page refuses to render anything without the area's password,
 *   • it is `noindex`, disallowed in robots.txt and asserted out of the
 *     sitemap (src/app/sitemap.test.ts),
 *   • the operator turns it on per area and can revoke it in one click.
 *
 * The owner accepted this trade knowingly (2026-08-11): the crew already
 * gets every coordinate through the shared Google Sheet, and a map they
 * can open on a phone beats reading decimal degrees off a spreadsheet.
 * The password is what keeps a forwarded link from being enough on its own.
 */

/** URL shape. 24 base64url chars = 18 random bytes; the upper bound is the
 *  column width, so a hand-typed monster is rejected before the DB sees it. */
export const CREW_TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;

/** Short enough to say out loud in a group chat, long enough not to be
 *  guessed within the rate limit below. */
export const CREW_PASSWORD_MIN = 6;
export const CREW_PASSWORD_MAX = 120;

export function newCrewToken(): string {
  return randomBytes(18).toString("base64url");
}

export function crewMapUrl(token: string): string {
  return `${printableSiteUrl()}/tym/${token}`;
}

/**
 * Cookie name for one area's unlocked state.
 *
 * Derived from the token rather than from the area id so two areas never
 * share a cookie, and hashed so a stray screenshot of devtools doesn't
 * hand over the URL. Scoped to the area's own path when set.
 */
export function crewCookieName(token: string): string {
  return `crew_${sha256(token).slice(0, 16)}`;
}

/**
 * What a successfully unlocked browser stores.
 *
 * A derivation of (token, password), not a session id: there is no server
 * state to keep, changing the password invalidates every cookie that was
 * ever handed out, and nobody can forge one without knowing the password
 * they would have had to type anyway. No secret of the app's own is
 * involved on purpose — this gate is exactly as strong as the password,
 * and pretending otherwise by mixing in a server key would only hide that.
 */
export function crewCookieValue(token: string, password: string): string {
  return sha256(`${token}:${password}`);
}

/** Constant-time compare of a presented cookie against the expected one. */
export function crewCookieOk(
  presented: string | undefined,
  token: string,
  password: string,
): boolean {
  if (!presented) return false;
  const expected = crewCookieValue(token, password);
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

/** Constant-time compare of a typed password against the stored one. */
export function crewPasswordOk(typed: string, stored: string): boolean {
  const a = Buffer.from(sha256(typed), "hex");
  const b = Buffer.from(sha256(stored), "hex");
  return timingSafeEqual(a, b);
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// ---------------------------------------------------------------- throttle

/**
 * Attempt budget per (IP, token).
 *
 * A shared word is a weak secret, so the gate has to be slow rather than
 * clever: 10 tries per 10 minutes turns even a 4-digit guess into days.
 * In-memory like the vote limiter — one process per VPS, and a restart
 * costing an attacker nothing is fine at this scale.
 */
const UNLOCK_WINDOW_MS = 10 * 60_000;
const UNLOCK_MAX_TRIES = 10;

const buckets = new Map<string, { count: number; firstAt: number }>();

/** True while the caller is within budget; counts the attempt. */
export function rateLimitCrewUnlock(key: string, now = Date.now()): boolean {
  const hit = buckets.get(key);
  if (!hit || now - hit.firstAt > UNLOCK_WINDOW_MS) {
    buckets.set(key, { count: 1, firstAt: now });
    // Cheap sweep so a stream of distinct IPs can't grow the map forever.
    if (buckets.size > 500) {
      for (const [k, v] of buckets) {
        if (now - v.firstAt > UNLOCK_WINDOW_MS) buckets.delete(k);
      }
    }
    return true;
  }
  if (hit.count >= UNLOCK_MAX_TRIES) return false;
  hit.count += 1;
  return true;
}

/** Test seam — the limiter is module state. */
export function resetCrewUnlockLimits(): void {
  buckets.clear();
}
