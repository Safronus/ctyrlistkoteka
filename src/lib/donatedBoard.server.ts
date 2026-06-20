import { promises as fs } from "node:fs";
import path from "node:path";
import { FindState } from "@prisma/client";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import { prisma } from "@/lib/db";
import { donatedBoardSchema, DONATED_BOARD_MIN_FIND_ID } from "./donatedBoard";

/**
 * Server-only filesystem side of the donated-board list. Stored as a tiny
 * JSON under `data/.admin/` (admin-internal config, next to the special-
 * finds + home-rotation settings — not collection data), atomically
 * written by the admin action and read by the home page.
 *
 * Empty by default — the author fills it in via /admin as clovers get
 * handed out. Order is kept ascending by id so the home board lays the
 * pins out "postupně dle čísla".
 */

export const DONATED_BOARD_DIR = path.dirname(ADMIN_ROOTS.backups);
export const DONATED_BOARD_PATH = path.join(
  DONATED_BOARD_DIR,
  "donated-board.json",
);

/** Read the raw configured id list. Missing/invalid file → empty.
 *  Deduped + sorted ascending. Never throws. */
export async function getDonatedBoardIds(): Promise<number[]> {
  try {
    const raw = await fs.readFile(DONATED_BOARD_PATH, "utf8");
    const parsed = donatedBoardSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    return [...new Set(parsed.data)].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** Ids to actually render on the home board: the configured list filtered
 *  to finds that still exist AND still carry the DONATED state, so a pin
 *  vanishes if its donation is ever undone. Sorted ascending. */
export async function getDonatedBoardForDisplay(): Promise<number[]> {
  const ids = await getDonatedBoardIds();
  if (ids.length === 0) return [];
  const rows = await prisma.find.findMany({
    where: { id: { in: ids }, states: { some: { state: FindState.DONATED } } },
    select: { id: true },
  });
  const stillDonated = new Set(rows.map((r) => r.id));
  return ids.filter((id) => stillDonated.has(id));
}

export interface DonatedCandidate {
  id: number;
  foundAt: Date | null;
  onBoard: boolean;
}

/** Donated finds eligible for the board — id >= DONATED_BOARD_MIN_FIND_ID
 *  (earlier ones predate the apology offer), newest first, each flagged
 *  with whether it's currently on the board. Drives the /admin toggle
 *  list. */
export async function getDonatedCandidates(): Promise<DonatedCandidate[]> {
  const [rows, ids] = await Promise.all([
    prisma.find.findMany({
      where: {
        id: { gte: DONATED_BOARD_MIN_FIND_ID },
        states: { some: { state: FindState.DONATED } },
      },
      select: { id: true, foundAt: true },
      orderBy: { id: "desc" },
    }),
    getDonatedBoardIds(),
  ]);
  const onBoard = new Set(ids);
  return rows.map((r) => ({
    id: r.id,
    foundAt: r.foundAt,
    onBoard: onBoard.has(r.id),
  }));
}
