"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, getRequestIp } from "@/lib/admin/session";
import { appendAudit } from "@/lib/admin/audit";
import { prisma } from "@/lib/db";
import { readSiteSettings, writeSiteSettings } from "@/lib/admin/siteSettings";

type Result = { ok: true; label: string } | { ok: false; error: string };

/**
 * Repoints the origin every "how far from home" distance is measured
 * from.
 *
 * Validated against the actual locations table rather than just bounds-
 * checked: an id that doesn't exist would leave every distance on the
 * public site blank, with nothing on screen explaining why.
 */
export async function setDistanceOriginAction(
  locationId: number,
): Promise<Result> {
  try {
    await requireAuth();
  } catch {
    return { ok: false, error: "Neautentizováno" };
  }
  if (!Number.isInteger(locationId) || locationId <= 0) {
    return { ok: false, error: "Neplatné číslo lokality" };
  }
  try {
    const loc = await prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true, code: true, displayName: true },
    });
    if (!loc) {
      return {
        ok: false,
        error: `Lokalita č. ${locationId} neexistuje — vzdálenosti by se přestaly počítat.`,
      };
    }
    const rows = await prisma.$queryRaw<Array<{ has: boolean }>>`
      SELECT center_point IS NOT NULL AS has FROM locations WHERE id = ${locationId}
    `;
    if (!rows[0]?.has) {
      return {
        ok: false,
        error: `Lokalita ${loc.code} nemá střed — od čeho by se měřilo?`,
      };
    }

    const current = await readSiteSettings();
    await writeSiteSettings({ ...current, distanceOriginLocationId: locationId });
    await appendAudit({
      action: "settings.update",
      ip: await getRequestIp(),
      details: { setting: "distanceOrigin", locationId },
    });
    // Distances appear on the collection, the map and the statistics.
    revalidatePath("/", "layout");
    return { ok: true, label: `${loc.code} — ${loc.displayName}` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Uložení selhalo",
    };
  }
}
