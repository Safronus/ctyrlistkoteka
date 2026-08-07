import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";

/**
 * Shared vocabulary for the "darování ve světě" admin.
 *
 * The domain in one paragraph: a CAMPAIGN is one wave of laminated
 * clovers with a shared message; an AREA is one town within it (its own
 * map centre and scatter radius); an ITEM is one physical card, tied to
 * one find, carrying a random `/d/<uuid>` landing page and — once the
 * operator sets it — the coordinates of where it was hidden.
 *
 * Those coordinates are the one genuinely sensitive thing here. They must
 * never reach a public route: publishing them turns "you happened to find
 * a clover" into "here is a list of clovers to collect". Everything in
 * this module is admin-only and the public landing page deliberately
 * reads none of it.
 */

// Labels, tones, the QR option bag and the scatter maths live in
// ./dropVocab so client components can import them without pulling Prisma
// into the browser bundle. Re-exported here so server code has one import.
export * from "./dropVocab";

/** A fresh landing token. UUID v4 — unguessable, and at the 4 cm these
 *  cards print at the denser QR still gives ~0.9 mm modules. */
export function newDropToken(): string {
  return randomUUID();
}

/** Everything the admin campaign page needs, in one round trip. */
export async function loadCampaign(id: number) {
  return prisma.dropCampaign.findUnique({
    where: { id },
    include: {
      areas: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      items: {
        orderBy: { findId: "asc" },
        include: { _count: { select: { scans: true } } },
      },
    },
  });
}

export type CampaignWithItems = NonNullable<
  Awaited<ReturnType<typeof loadCampaign>>
>;
export type CampaignItem = CampaignWithItems["items"][number];
