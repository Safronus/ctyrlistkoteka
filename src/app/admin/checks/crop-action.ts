"use server";

import { revalidatePath } from "next/cache";
import { appendAudit } from "@/lib/admin/audit";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { recropFind } from "@/lib/admin/recrop";

export interface RecropActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Server action behind the "Ořezat" dialog: re-crops a find's CROP from its
 * ORIGINAL using the square region the operator selected. Auth-gated, audited
 * as a file.replace, and revalidates the checks page + the public find pages
 * so the fresh crop shows immediately.
 */
export async function recropFindAction(
  formData: FormData,
): Promise<RecropActionResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) return { ok: false, error: "Unauthenticated" };
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const findId = Number(formData.get("findId"));
  const x = Number(formData.get("x"));
  const y = Number(formData.get("y"));
  const size = Number(formData.get("size"));

  const result = await recropFind(findId, { x, y, size });
  if (!result.ok) return { ok: false, error: result.error };

  await appendAudit({
    action: "file.replace",
    ip,
    credentialLabel,
    details: {
      scope: "recrop",
      findId,
      region: { x, y, size },
      width: result.width,
      height: result.height,
    },
  });

  revalidatePath("/admin/checks");
  revalidatePath("/[locale]/sbirka/[id]", "page");

  return { ok: true };
}
