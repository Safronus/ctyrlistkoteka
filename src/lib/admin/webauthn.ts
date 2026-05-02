/** Configuration shim around @simplewebauthn/server. Centralises the
 *  Relying Party identity (RP_ID + expected origin) so every ceremony
 *  uses the same values, and exposes typed helpers the server actions
 *  call. RP_ID is the *site's* hostname (no scheme, no port) — the
 *  browser binds passkeys to it, so changing it after registration
 *  invalidates existing keys. */

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
export const EXPECTED_ORIGIN =
  process.env.ADMIN_EXPECTED_ORIGIN ?? new URL(SITE_URL).origin;

/** Re-exports — keeps server actions free of the @simplewebauthn import
 *  path so the implementation can be swapped without touching every
 *  action. */
export {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
