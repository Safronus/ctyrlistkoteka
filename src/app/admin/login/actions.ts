"use server";

import { setTimeout as sleep } from "node:timers/promises";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  RP_ID,
  getExpectedOrigin,
} from "@/lib/admin/webauthn";
import {
  findCredentialById,
  hasAnyCredential,
  listCredentials,
  updateCredentialUsage,
} from "@/lib/admin/credentials";
import { getAdminSession, getRequestIp } from "@/lib/admin/session";
import { appendAudit } from "@/lib/admin/audit";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";

const FAIL_DELAY_MS = 600;

export async function startAuthenticationAction(): Promise<{
  ok: boolean;
  options?: PublicKeyCredentialRequestOptionsJSON;
  error?: string;
}> {
  if (!(await hasAnyCredential())) {
    return {
      ok: false,
      error: "Žádný passkey ještě není zaregistrovaný — projdi /admin/setup.",
    };
  }

  const credentials = await listCredentials();
  // allowCredentials lets the browser hint which keys to offer the
  // user. If we left it empty, the user might be shown an empty
  // picker on a device that's never been enrolled — passing the list
  // makes the failure mode much clearer ("no matching passkey").
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: credentials.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[] | undefined,
    })),
    userVerification: "preferred",
  });

  const session = await getAdminSession();
  session.pendingLoginChallenge = options.challenge;
  await session.save();

  return { ok: true, options };
}

export async function finishAuthenticationAction(
  response: AuthenticationResponseJSON,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getAdminSession();
  const expectedChallenge = session.pendingLoginChallenge;
  const ip = await getRequestIp();
  const fail = async (reason: string): Promise<{ ok: false; error: string }> => {
    // Sleep before responding so a timing-based oracle can't tell
    // "credential not found" apart from "signature invalid".
    await sleep(FAIL_DELAY_MS);
    await appendAudit({
      action: "auth.failed",
      ip,
      details: { reason },
    });
    return { ok: false, error: "Ověření selhalo." };
  };

  if (!expectedChallenge) {
    return fail("missing-challenge");
  }
  const credential = await findCredentialById(response.id);
  if (!credential) {
    return fail("unknown-credential");
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: await getExpectedOrigin(),
      expectedRPID: RP_ID,
      credential: {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey, "base64url"),
        counter: credential.counter,
        transports: credential.transports as
          | AuthenticatorTransportFuture[]
          | undefined,
      },
      requireUserVerification: false,
    });
  } catch {
    return fail("verify-throw");
  }
  if (!verification.verified) {
    return fail("verify-false");
  }

  // Authenticator counter regression is a possible cloned-key signal.
  // counter === 0 is the "platform doesn't track counter" case (Apple),
  // so we only enforce monotonicity when both old and new are non-zero.
  const newCounter = verification.authenticationInfo.newCounter;
  if (
    credential.counter > 0 &&
    newCounter > 0 &&
    newCounter <= credential.counter
  ) {
    return fail("counter-regression");
  }
  await updateCredentialUsage(credential.id, newCounter);

  session.pendingLoginChallenge = undefined;
  session.credentialLabel = credential.label;
  session.iat = Date.now();
  await session.save();

  await appendAudit({
    action: "auth.login",
    ip,
    credentialLabel: credential.label,
  });
  return { ok: true };
}
