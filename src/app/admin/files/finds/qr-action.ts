"use server";

import { requireAuth } from "@/lib/admin/session";
import { renderFindQrSvg } from "@/lib/admin/qr";

/** Generates the styled QR SVG for a find detail URL. Auth-gated —
 *  the rendered SVG is fine to expose, but the action lives behind
 *  the admin login so it doesn't grow into a generic public endpoint
 *  someone could hammer to fingerprint find IDs. */
export async function getFindQr(
  findId: number,
): Promise<{ ok: true; svg: string } | { ok: false; error: string }> {
  try {
    await requireAuth();
  } catch {
    return { ok: false, error: "Neautentizováno" };
  }
  if (!Number.isInteger(findId) || findId <= 0) {
    return { ok: false, error: "Neplatné ID nálezu" };
  }
  try {
    const svg = renderFindQrSvg(findId);
    return { ok: true, svg };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Generování selhalo",
    };
  }
}
