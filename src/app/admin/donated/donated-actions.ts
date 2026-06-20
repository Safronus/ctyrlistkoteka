"use server";

import { revalidatePath } from "next/cache";
import { FindState } from "@prisma/client";
import { atomicWrite, ensureDir } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { prisma } from "@/lib/db";
import {
  getDonatedBoardIds,
  DONATED_BOARD_DIR,
  DONATED_BOARD_PATH,
} from "@/lib/donatedBoard.server";

type Result = { ok: true } | { ok: false; error: string };

async function persist(ids: number[]): Promise<void> {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  await ensureDir(DONATED_BOARD_DIR);
  await atomicWrite(DONATED_BOARD_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
}

function refresh() {
  // The home page reads the board; revalidate the whole locale tree so a
  // newly-added clover shows on the next visit.
  revalidatePath("/", "layout");
  revalidatePath("/admin/donated");
}

/** Add a find id to the donated board. Only finds carrying the DONATED
 *  state are accepted. */
export async function addDonatedFind(findIdRaw: number): Promise<Result> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) return { ok: false, error: "Nepřihlášeno." };
  await touchSession();

  const findId = Number(findIdRaw);
  if (!Number.isInteger(findId) || findId <= 0) {
    return { ok: false, error: "Neplatné číslo nálezu." };
  }

  const donated = await prisma.find.findFirst({
    where: { id: findId, states: { some: { state: FindState.DONATED } } },
    select: { id: true },
  });
  if (!donated) {
    const exists = await prisma.find.findUnique({
      where: { id: findId },
      select: { id: true },
    });
    return {
      ok: false,
      error: exists
        ? `Nález #${findId} nemá stav „Darovaný“.`
        : `Nález #${findId} neexistuje.`,
    };
  }

  const ids = await getDonatedBoardIds();
  if (ids.includes(findId)) {
    return { ok: false, error: `Nález #${findId} už v seznamu je.` };
  }
  await persist([...ids, findId]);

  await appendAudit({
    action: "settings.update",
    ip: await getRequestIp(),
    credentialLabel: session.credentialLabel,
    details: { file: "donated-board.json", op: "add", findId },
  });
  refresh();
  return { ok: true };
}

/** Remove a find id from the donated board. */
export async function removeDonatedFind(findId: number): Promise<Result> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) return { ok: false, error: "Nepřihlášeno." };
  await touchSession();

  const ids = await getDonatedBoardIds();
  await persist(ids.filter((id) => id !== findId));

  await appendAudit({
    action: "settings.update",
    ip: await getRequestIp(),
    credentialLabel: session.credentialLabel,
    details: { file: "donated-board.json", op: "remove", findId },
  });
  refresh();
  return { ok: true };
}
