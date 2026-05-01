"use server";

import { redirect } from "next/navigation";
import { FindState } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface FindDonationActionState {
  /** Czech message for the failure case, or null on initial render. On
   *  success the action redirects, so the success branch never returns
   *  to the client. */
  error: string | null;
}

export const FIND_DONATION_INITIAL: FindDonationActionState = { error: null };

/**
 * Server action behind the home-page "Najdi si svůj čtyřlístek" form.
 * Three checks before navigating to /sbirka/<id>:
 *
 *   1. Format — only digits, no leading zero, no `#`. Matches what the
 *      user told the recipient ("just type 15234").
 *   2. Find exists in the DB. Some IDs are still queued in the user's
 *      local archive and not yet imported, so this catches recipients
 *      asking too early with a friendly message.
 *   3. Find has the DONATED state. Without this, every find ID would
 *      resolve and the form would double as a generic search — but
 *      its semantic is "I received this clover".
 *
 * Anonymized donations are intentionally NOT filtered out here; the
 * detail page renders a privacy stub for those, and that stub IS the
 * useful answer ("yes, this is your clover, no further info shown").
 */
export async function findDonationAction(
  _prev: FindDonationActionState,
  formData: FormData,
): Promise<FindDonationActionState> {
  const raw = String(formData.get("id") ?? "").trim();
  if (raw === "") {
    return { error: "Zadej číslo svého nálezu." };
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    return {
      error: "Zadej jen číslice — bez nul na začátku a bez znaku #.",
    };
  }
  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0 || id > 2_000_000) {
    return { error: "Číslo je mimo rozsah." };
  }

  const find = await prisma.find.findUnique({
    where: { id },
    select: {
      id: true,
      states: { select: { state: true } },
    },
  });
  if (!find) {
    return {
      error: `Nález #${id} u nás zatím není — sbírka se postupně doplňuje, zkus to později.`,
    };
  }
  const isDonated = find.states.some((s) => s.state === FindState.DONATED);
  if (!isDonated) {
    return {
      error: `Nález #${id} sice ve sbírce máme, ale není mezi darovanými. Zkontroluj číslo, které jsi dostal/a.`,
    };
  }

  redirect(`/sbirka/${id}`);
}
