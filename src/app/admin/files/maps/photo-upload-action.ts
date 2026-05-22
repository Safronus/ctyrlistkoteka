"use server";

import path from "node:path";
import { revalidatePath } from "next/cache";
import { atomicWrite } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { checkImageMagic } from "@/lib/admin/imageMagic";
import { safeBaseName, safeJoin } from "@/lib/admin/paths";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import {
  invalidateLocationPhotosCache,
  resolveLocationMapPhoto,
} from "@/lib/locationPhotos";

const PHOTO_SUFFIX = "_reálné foto";
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface UploadResult {
  ok: boolean;
  /** On success, the on-disk filename written into
   *  `generated/location-photos/`. Used by the client UI to deep-link
   *  into the new photo's admin detail page. */
  filename?: string;
  size?: number;
  error?: string;
}

/**
 * Map-detail-side upload action: takes a single arbitrarily-named file
 * and saves it as the real photo for `mapName`. The destination
 * basename is derived from the map filename (NOT the uploaded file's
 * own name) — that's the whole point of this action vs. the generic
 * location-photos upload form, which requires the user to name the
 * file with the `_reálné foto` suffix themselves.
 *
 * Rejects if a real photo already exists for this map — the user
 * needs to delete the existing one from its own admin detail first
 * (clean, atomic semantics — no implicit replace).
 */
export async function uploadMapRealPhoto(
  formData: FormData,
): Promise<UploadResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, error: "Unauthenticated" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const mapNameRaw = formData.get("mapName");
  const file = formData.get("file");
  if (typeof mapNameRaw !== "string" || mapNameRaw.length === 0) {
    return { ok: false, error: "Chybí název mapy" };
  }
  if (!(file instanceof File)) {
    return { ok: false, error: "Soubor nepřišel" };
  }

  let mapName: string;
  try {
    mapName = safeBaseName(mapNameRaw);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  // Reject anonymized maps explicitly — the photo loader hides them
  // from the public site too, so uploading one would be dead data.
  // We don't have the DB row handy here; the map detail page already
  // surfaces the anon state via MapAnonymizeToggleButton, and the
  // existing real-photo loader honours `isAnonymized: false` from
  // the basename match. Skip the anon check here and rely on the
  // existing dirCache lookup below to detect duplicates.

  // Map basename = filename minus extension. The on-disk map filename
  // doubles as the DB's `originalFilename`, which is the key the
  // public-side `getLocationMapPhotoUrl` uses to find the bound photo
  // — so basing the photo name on `mapName` lines the two up.
  const mapExt = path.extname(mapName);
  const mapBaseName = mapName.slice(0, mapName.length - mapExt.length);
  if (mapBaseName.length === 0) {
    return { ok: false, error: "Mapa nemá jméno před příponou" };
  }

  // Refuse if a real photo for this map already exists — the user
  // must delete the existing photo (via its own admin detail page)
  // first. Keeps semantics atomic: each map has 0 or 1 photo and we
  // never silently overwrite an existing photo's bytes.
  const existing = await resolveLocationMapPhoto({
    originalFilename: mapName,
    isAnonymized: false,
  });
  if (existing) {
    return {
      ok: false,
      error: `Reálná fotka pro tuto mapu už existuje ("${existing.filename}"). Smaž ji nejdřív v jejím detailu.`,
    };
  }

  if (file.size === 0) {
    return { ok: false, error: "Prázdný soubor" };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `Soubor je větší než ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB`,
    };
  }

  const uploadedExt = path.extname(file.name).slice(1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(uploadedExt)) {
    return {
      ok: false,
      error: `Nepovolená přípona ".${uploadedExt}" — povolené: .jpg / .jpeg / .png / .webp`,
    };
  }

  const arrayBuffer = await file.arrayBuffer();
  const data = Buffer.from(arrayBuffer);
  const magicError = checkImageMagic(uploadedExt, data);
  if (magicError) {
    return { ok: false, error: magicError };
  }

  const targetBaseName = `${mapBaseName}${PHOTO_SUFFIX}.${uploadedExt}`;
  let absolutePath: string;
  try {
    absolutePath = safeJoin("locationPhotos", targetBaseName);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  try {
    await atomicWrite(absolutePath, data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/map-real-photo-upload] write failed", {
      mapName,
      target: targetBaseName,
      message,
    });
    await appendAudit({
      action: "file.upload",
      ip,
      credentialLabel,
      details: {
        scope: "location-photos",
        file: targetBaseName,
        outcome: "error",
        reason: message,
        viaMapDetail: mapName,
      },
    });
    return { ok: false, error: `Server: ${message}` };
  }

  await appendAudit({
    action: "file.upload",
    ip,
    credentialLabel,
    details: {
      scope: "location-photos",
      file: targetBaseName,
      size: data.byteLength,
      mapBaseName,
      viaMapDetail: mapName,
      outcome: "ok",
    },
  });

  invalidateLocationPhotosCache();
  // Refresh both the map detail (so the freshly uploaded photo appears
  // there) and the location-photos listing where the new file shows
  // up too. The cache invalidation above is what actually makes the
  // public site notice; revalidatePath just busts Next's RSC cache.
  revalidatePath(
    `/admin/files/maps/${encodeURIComponent(mapName)}`,
  );
  revalidatePath("/admin/files/location-photos");

  return {
    ok: true,
    filename: targetBaseName,
    size: data.byteLength,
  };
}
