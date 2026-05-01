"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { getFindPhotos, resolveAnonPhotoPath } from "@/lib/findPhotos";
import {
  FIND_PHOTO_UNLOCK_INITIAL,
  type FindPhotoUnlockState,
} from "./findPhotoUnlockTypes";

/**
 * Server action for the donation-photo modal. Verifies the visitor's
 * unlock code against the global secret and, on success, returns base64
 * data URLs for every ANON photo bound to the find. The bytes never
 * leave the server otherwise — Nginx 404s `*_ANON.*` files at the file
 * level (see deploy/nginx.conf.template), so a leaked URL guess can't
 * exfiltrate the image.
 *
 * The code lives in `FIND_PHOTO_UNLOCK_CODE` env var on the VPS.
 * Missing config is reported back to the modal as `missing-config`
 * instead of silently failing — the author should know they haven't
 * set a code before sharing photos with recipients.
 */
export async function unlockFindPhotos(
  _prev: FindPhotoUnlockState,
  formData: FormData,
): Promise<FindPhotoUnlockState> {
  const findIdRaw = formData.get("findId");
  const codeRaw = formData.get("code");
  const findId =
    typeof findIdRaw === "string" ? Number(findIdRaw) : NaN;
  const code = typeof codeRaw === "string" ? codeRaw.trim() : "";
  if (!Number.isInteger(findId) || findId <= 0) {
    return { ...FIND_PHOTO_UNLOCK_INITIAL, status: "error" };
  }
  if (code.length === 0) {
    return { ...FIND_PHOTO_UNLOCK_INITIAL, status: "invalid" };
  }
  const expected = process.env.FIND_PHOTO_UNLOCK_CODE;
  if (!expected || expected.length === 0) {
    return { ...FIND_PHOTO_UNLOCK_INITIAL, status: "missing-config" };
  }
  // Constant-time compare — short codes wouldn't reveal much in
  // practice, but the helper is cheap and keeps the policy honest.
  if (!constantTimeEquals(code, expected)) {
    return { ...FIND_PHOTO_UNLOCK_INITIAL, status: "invalid" };
  }

  const photos = await getFindPhotos(findId);
  const anon = photos.filter((p) => p.isAnonymized);
  const out: { slot: string; dataUrl: string }[] = [];
  for (const p of anon) {
    const resolved = await resolveAnonPhotoPath(findId, p.slot);
    if (!resolved) continue;
    try {
      const buf = await fs.readFile(resolved.path);
      const ext = path.extname(resolved.filename).toLowerCase().slice(1);
      const mime =
        ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : "image/jpeg";
      out.push({
        slot: p.slot,
        dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
      });
    } catch {
      // File listed in the cache but unreadable — skip silently;
      // the modal will keep showing the placeholder for that slot.
    }
  }
  return { status: "ok", photos: out };
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
