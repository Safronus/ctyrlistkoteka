"use server";

import { revalidatePath } from "next/cache";
import { atomicWrite, ensureDir } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { prisma } from "@/lib/db";
import { specialFindSchema, type SpecialFind } from "@/lib/specialFinds";
import {
  getSpecialFinds,
  SPECIAL_FINDS_DIR,
  SPECIAL_FINDS_PATH,
} from "@/lib/specialFinds.server";

type Result = { ok: true } | { ok: false; error: string };

async function persist(list: SpecialFind[]): Promise<void> {
  const sorted = [...list].sort((a, b) => a.findId - b.findId);
  await ensureDir(SPECIAL_FINDS_DIR);
  await atomicWrite(SPECIAL_FINDS_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
}

function refresh() {
  // The find detail (ISR) + /statistiky read the config; revalidate the
  // whole locale tree so a newly-assigned effect shows on the next visit.
  revalidatePath("/", "layout");
  revalidatePath("/admin/special");
}

/** Assign (or re-assign) a special effect to a find id. */
export async function addSpecialFind(
  findIdRaw: number,
  effectRaw: string,
): Promise<Result> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) return { ok: false, error: "Nepřihlášeno." };
  await touchSession();

  const parsed = specialFindSchema.safeParse({
    findId: findIdRaw,
    effect: effectRaw,
  });
  if (!parsed.success) {
    return { ok: false, error: "Neplatné číslo nálezu nebo efekt." };
  }
  const { findId, effect } = parsed.data;

  const exists = await prisma.find.findUnique({
    where: { id: findId },
    select: { id: true },
  });
  if (!exists) return { ok: false, error: `Nález #${findId} neexistuje.` };

  const list = await getSpecialFinds();
  const next: SpecialFind[] = [
    ...list.filter((s) => s.findId !== findId),
    { findId, effect },
  ];
  await persist(next);

  await appendAudit({
    action: "settings.update",
    ip: await getRequestIp(),
    credentialLabel: session.credentialLabel,
    details: { file: "special-finds.json", op: "add", findId, effect },
  });
  refresh();
  return { ok: true };
}

/** Remove the special effect from a find id. */
export async function removeSpecialFind(findId: number): Promise<Result> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) return { ok: false, error: "Nepřihlášeno." };
  await touchSession();

  const list = await getSpecialFinds();
  const next = list.filter((s) => s.findId !== findId);
  await persist(next);

  await appendAudit({
    action: "settings.update",
    ip: await getRequestIp(),
    credentialLabel: session.credentialLabel,
    details: { file: "special-finds.json", op: "remove", findId },
  });
  refresh();
  return { ok: true };
}
