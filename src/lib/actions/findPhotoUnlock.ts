"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
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
 * Per-find override takes precedence: when `Find.unlockCode` is set
 * (managed via /admin/files/donation-photos/<name>), THAT value is
 * the only accepted code for unlocking this find's anonymous donation
 * photos — the global FIND_PHOTO_UNLOCK_CODE env var is ignored for
 * this find. When `unlockCode` is null/empty the global secret is
 * used as a fallback so existing recipients keep working without per-
 * find configuration. Missing both ways is reported back as
 * `missing-config` so the author notices before sharing photos with
 * recipients.
 *
 * Brute-force defences (layered with Nginx's ctyr_main zone, 20 r/s
 * burst 40):
 *   - 600 ms stall on every failed attempt (`failDelay`) — knocks the
 *     effective rate well below 2 attempts/sec for a scripted attacker.
 *   - 256-char hard cap on the submitted code (`MAX_CODE_LENGTH`) —
 *     any longer payload is rejected as invalid before we even touch
 *     the secret, so a slow-loris-style oversized POST can't burn CPU.
 *   - console.warn on invalid attempts so PM2 logs surface activity.
 */

/** Hard cap on the submitted code length. Long enough to allow a
 *  diceware passphrase, short enough to keep oversized POSTs from
 *  reaching the constant-time compare path. */
const MAX_CODE_LENGTH = 256;

/** Per-attempt stall on failure. 600 ms is invisible to a legit
 *  recipient typing once but caps a brute-forcer at ~1.5 tries/sec
 *  even from a single IP, well within Nginx's per-IP rate limit. */
const FAIL_DELAY_MS = 600;

export async function unlockFindPhotos(
  _prev: FindPhotoUnlockState,
  formData: FormData,
): Promise<FindPhotoUnlockState> {
  const findIdRaw = formData.get("findId");
  const codeRaw = formData.get("code");
  const findId =
    typeof findIdRaw === "string" ? Number(findIdRaw) : Number.NaN;
  const code = typeof codeRaw === "string" ? codeRaw.trim() : "";
  if (!Number.isInteger(findId) || findId <= 0) {
    return { ...FIND_PHOTO_UNLOCK_INITIAL, status: "error" };
  }
  if (code.length === 0 || code.length > MAX_CODE_LENGTH) {
    // Treat oversized inputs as plain "invalid" — telling the user
    // the cap exists would just guide an attacker to stay under it.
    await failDelay();
    return { ...FIND_PHOTO_UNLOCK_INITIAL, status: "invalid" };
  }
  // Per-find code takes precedence; global env var is fallback.
  // Single SELECT — the row hit here is the same find row the
  // unlock action would touch anyway, no extra round-trip cost over
  // the previous global-only path.
  const findRow = await prisma.find.findUnique({
    where: { id: findId },
    select: { unlockCode: true },
  });
  const perFindCode = findRow?.unlockCode ?? null;
  const expected =
    perFindCode && perFindCode.length > 0
      ? perFindCode
      : process.env.FIND_PHOTO_UNLOCK_CODE;
  if (!expected || expected.length === 0) {
    return { ...FIND_PHOTO_UNLOCK_INITIAL, status: "missing-config" };
  }
  // Constant-time compare — short codes wouldn't reveal much in
  // practice, but the helper is cheap and keeps the policy honest.
  if (!constantTimeEquals(code, expected)) {
    // PM2 captures stderr — visible via `pm2 logs ctyrlistkoteka`,
    // so the author can spot scripted brute-force attempts. The find
    // ID is the only thing logged; the submitted code never is.
    console.warn(
      `[findPhotoUnlock] invalid code attempt for findId=${findId}`,
    );
    await failDelay();
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

function failDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, FAIL_DELAY_MS));
}
