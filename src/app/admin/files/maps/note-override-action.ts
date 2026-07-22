"use server";

import { revalidatePath } from "next/cache";
import { appendAudit } from "@/lib/admin/audit";
import { safeBaseName } from "@/lib/admin/paths";
import { extractMapId, resolveDiskPath } from "@/lib/admin/scopes";
import { resolveV2MapFileByName } from "@/lib/admin/mapsV2";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { writeMapNoteOverride } from "@/lib/mapNoteOverrides";

export interface SetMapNoteOverrideResult {
  ok: boolean;
  mapId?: number;
  error?: string;
}

/**
 * Upsert a location map's web-display caption override (CS + optional EN)
 * in `data/.admin/map-note-overrides.json`. The exact analogue of
 * {@link file://../finds/note-override-action.ts} but keyed by MAP_ID.
 * Does NOT touch the filename or the DB row — it's a pure display layer
 * read by the public map caption (find detail + location detail). Clearing
 * both variants removes the override.
 */
export async function setMapNoteOverride(
  formData: FormData,
): Promise<SetMapNoteOverrideResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) return { ok: false, error: "Unauthenticated" };
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const rawName = formData.get("name");
  const cs =
    typeof formData.get("cs") === "string" ? String(formData.get("cs")) : "";
  const en =
    typeof formData.get("en") === "string" ? String(formData.get("en")) : "";
  if (typeof rawName !== "string" || rawName.length === 0) {
    return { ok: false, error: "Missing name" };
  }

  let baseName: string;
  try {
    baseName = safeBaseName(rawName);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  // Flat resolve first (v1 / stray files), then the v2 manifest fallback
  // (v2 maps live nested under Nosné mapy/). The MAP_ID comes from the
  // trailing 5-digit číslo in the basename — `extractMapId` reads both the
  // v1 (…+00025.png) and v2 (…+00025.png) forms, so no filename parse.
  const resolved =
    (await resolveDiskPath("locationMaps", baseName)) ??
    (await resolveV2MapFileByName(baseName));
  if (!resolved) return { ok: false, error: "Soubor neexistuje" };

  const mapId = extractMapId(resolved.name);
  if (mapId === null) {
    return {
      ok: false,
      error: `Z názvu „${resolved.name}" nelze získat číslo mapy`,
    };
  }

  try {
    await writeMapNoteOverride(mapId, { cs, en });
  } catch (err) {
    return {
      ok: false,
      mapId,
      error: `Uložení selhalo: ${(err as Error).message}`,
    };
  }

  await appendAudit({
    action: "json.update",
    ip,
    credentialLabel,
    details: {
      scope: "map-note-override",
      mapId,
      hasCs: cs.trim().length > 0,
      hasEn: en.trim().length > 0,
    },
  });

  revalidatePath("/admin/files/maps");
  revalidatePath(`/admin/files/maps/${encodeURIComponent(resolved.name)}`);
  // Regenerate the public pages that render the map caption (all locales):
  // the location detail and every find detail that shows this location map.
  revalidatePath("/[locale]/lokality/[mapId]", "page");
  revalidatePath("/[locale]/sbirka/[id]", "page");

  return { ok: true, mapId };
}
