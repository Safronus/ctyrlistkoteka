"use server";

import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { clientIpFromHeaders } from "@/lib/clientIp";
import {
  CREW_TOKEN_RE,
  crewCookieName,
  crewCookieValue,
  crewPasswordOk,
  rateLimitCrewUnlock,
} from "@/lib/crewMap";

/**
 * The one write the crew map surface accepts: typing the password.
 *
 * Deliberately says nothing an attacker could use. A wrong password, an
 * unknown token and an area whose map was switched off all answer the
 * same way, so probing the endpoint never reveals which areas exist.
 */

/** Thirty days: long enough that the crew types it once per wave, short
 *  enough that a phone lost after the wave ends stops working. */
const CREW_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export interface CrewUnlockResult {
  ok: boolean;
  /** Czech, ready to render — the page has no other error vocabulary. */
  error?: string;
}

export async function unlockCrewMapAction(
  token: string,
  password: string,
): Promise<CrewUnlockResult> {
  const wrong = { ok: false as const, error: "Heslo nesedí." };

  if (!CREW_TOKEN_RE.test(token)) return wrong;

  const ip = clientIpFromHeaders(await headers()) ?? "unknown";
  if (!rateLimitCrewUnlock(`${ip}|${token}`)) {
    return {
      ok: false,
      error: "Moc pokusů po sobě. Zkus to znovu za deset minut.",
    };
  }

  const area = await prisma.dropArea.findUnique({
    where: { crewToken: token },
    select: { crewPassword: true },
  });
  const stored = area?.crewPassword;
  if (!stored) return wrong;
  if (!crewPasswordOk(password, stored)) return wrong;

  const store = await cookies();
  store.set(crewCookieName(token), crewCookieValue(token, stored), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    // Scoped to this area's own page: one crew's cookie is never sent
    // anywhere else on the site, not even to another area's map.
    path: `/tym/${token}`,
    maxAge: CREW_COOKIE_MAX_AGE,
  });
  return { ok: true };
}
