"use server";

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  RP_ID,
  RP_NAME,
  EXPECTED_ORIGIN,
} from "@/lib/admin/webauthn";
import {
  addCredential,
  hasAnyCredential,
  listCredentials,
} from "@/lib/admin/credentials";
import { getAdminSession, getRequestIp } from "@/lib/admin/session";
import { appendAudit } from "@/lib/admin/audit";
import type {
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

/** Returns true when registration is closed — the gate flips after the
 *  first passkey lands so a stranger can't add their own key without
 *  authenticating with the existing one. */
async function isSetupLocked(): Promise<boolean> {
  // For now: lock once any credential exists. Adding a 2nd device would
  // be done from an authenticated /admin/credentials page (future work).
  return hasAnyCredential();
}

export async function startRegistrationAction(formData: FormData): Promise<{
  ok: boolean;
  options?: PublicKeyCredentialCreationOptionsJSON;
  error?: string;
}> {
  if (await isSetupLocked()) {
    return { ok: false, error: "Setup je uzamčen — passkey už existuje." };
  }
  const labelRaw = formData.get("label");
  const label = typeof labelRaw === "string" ? labelRaw.trim() : "";
  if (label.length < 2 || label.length > 60) {
    return { ok: false, error: "Pojmenování zařízení musí mít 2–60 znaků." };
  }

  const existing = await listCredentials();
  // Tells the authenticator what's already enrolled — prevents the
  // browser from offering the user a passkey that's already known
  // (which would be a no-op registration).
  const excludeCredentials = existing.map((c) => ({
    id: c.id,
    transports: c.transports as AuthenticatorTransportFuture[] | undefined,
  }));

  const options = await generateRegistrationOptions({
    rpID: RP_ID,
    rpName: RP_NAME,
    userName: label,
    userDisplayName: label,
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  const session = await getAdminSession();
  session.pendingRegistrationChallenge = options.challenge;
  session.pendingRegistrationLabel = label;
  await session.save();

  return { ok: true, options };
}

export async function finishRegistrationAction(
  response: RegistrationResponseJSON,
): Promise<{ ok: boolean; error?: string }> {
  if (await isSetupLocked()) {
    return { ok: false, error: "Setup je uzamčen — passkey už existuje." };
  }
  const session = await getAdminSession();
  const expectedChallenge = session.pendingRegistrationChallenge;
  const label = session.pendingRegistrationLabel;
  if (!expectedChallenge || !label) {
    return { ok: false, error: "Chybí pending challenge — začni znovu." };
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: EXPECTED_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });
  } catch (err) {
    return {
      ok: false,
      error: `Ověření selhalo: ${(err as Error).message}`,
    };
  }
  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, error: "Registrace neověřena." };
  }
  const { credential } = verification.registrationInfo;

  await addCredential({
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports,
    label,
    registeredAt: new Date().toISOString(),
  });

  // Clear the pending challenge + grant the just-registered session
  // an authenticated state so the visitor lands inside the admin
  // immediately. iat starts the sliding-window expiry.
  session.pendingRegistrationChallenge = undefined;
  session.pendingRegistrationLabel = undefined;
  session.credentialLabel = label;
  session.iat = Date.now();
  await session.save();

  const ip = await getRequestIp();
  await appendAudit({
    action: "auth.register",
    ip,
    credentialLabel: label,
  });

  return { ok: true };
}
