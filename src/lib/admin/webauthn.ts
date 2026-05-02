/** Configuration shim around @simplewebauthn/server. Centralises the
 *  Relying Party identity (RP_ID + expected origin) so every ceremony
 *  uses the same values, and exposes typed helpers the server actions
 *  call. RP_ID is the *site's* hostname (no scheme, no port) — the
 *  browser binds passkeys to it, so changing it after registration
 *  invalidates existing keys. */

import { headers } from "next/headers";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

function deriveRpId(): string {
  const explicit = process.env.ADMIN_RP_ID;
  if (explicit) return explicit;
  try {
    return new URL(SITE_URL).hostname;
  } catch {
    return "localhost";
  }
}

export const RP_ID = deriveRpId();
export const RP_NAME = "Čtyřlístkotéka admin";

/** Resolves the origin the browser is actually using *right now* from
 *  the request headers, not from `NEXT_PUBLIC_SITE_URL`. Needed because
 *  WebAuthn binds the registration to the precise origin the browser
 *  saw (scheme + host + optional port) — if we hardcode the env value
 *  and it disagrees with the request (typical mistake: env says
 *  `http://` while the site lives behind HTTPS), every ceremony
 *  fails with "unexpected origin".
 *
 *  Falls back to `ADMIN_EXPECTED_ORIGIN` env var, then to the parsed
 *  `NEXT_PUBLIC_SITE_URL` — used during local dev where headers may
 *  not carry a `host`. /admin is HTTPS-only in production, so the
 *  proto fallback defaults to `https`. */
export async function getExpectedOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
    return `${proto}://${host}`;
  }
  if (process.env.ADMIN_EXPECTED_ORIGIN) {
    return process.env.ADMIN_EXPECTED_ORIGIN;
  }
  return new URL(SITE_URL).origin;
}

/** Re-exports — keeps server actions free of the @simplewebauthn import
 *  path so the implementation can be swapped without touching every
 *  action. */
export {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
