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
import { DONATED_BOARD_MIN_FIND_ID } from "@/lib/donatedBoard";
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
  // toggled clover shows / hides on the next visit.
  revalidatePath("/", "layout");
  revalidatePath("/admin/donated");
}

/** Toggle a find on/off the donated board. Adding is only allowed for
 *  finds that carry the DONATED state and sit at or above the cutoff id
 *  (earlier finds predate the apology offer). Removing is unconditional. */
export async function setDonatedFind(
  findIdRaw: number,
  on: boolean,
): Promise<Result> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) return { ok: false, error: "Nepřihlášeno." };
  await touchSession();

  const findId = Number(findIdRaw);
  if (!Number.isInteger(findId) || findId <= 0) {
    return { ok: false, error: "Neplatné číslo nálezu." };
  }

  const ids = await getDonatedBoardIds();

  if (on) {
    if (findId < DONATED_BOARD_MIN_FIND_ID) {
      return {
        ok: false,
        error: `Nález #${findId} je starší než #${DONATED_BOARD_MIN_FIND_ID} — nemohl být darovaný přes nabídku.`,
      };
    }
    const donated = await prisma.find.findFirst({
      where: { id: findId, states: { some: { state: FindState.DONATED } } },
      select: { id: true },
    });
    if (!donated) {
      return { ok: false, error: `Nález #${findId} nemá stav „Darovaný“.` };
    }
    if (!ids.includes(findId)) await persist([...ids, findId]);
  } else {
    await persist(ids.filter((id) => id !== findId));
  }

  await appendAudit({
    action: "settings.update",
    ip: await getRequestIp(),
    credentialLabel: session.credentialLabel,
    details: { file: "donated-board.json", op: on ? "add" : "remove", findId },
  });
  refresh();
  return { ok: true };
}
