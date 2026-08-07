import { prisma } from "@/lib/db";
import { DropStatus } from "@/generated/prisma/client";

/**
 * Records one scan of an in-the-wild card and, on the first ever scan,
 * marks the card FOUND.
 *
 * Same no-PII rule as the other scan logs: a timestamp and the item id,
 * nothing about who scanned. Throttled per item so a page refresh (or a
 * bot hammering a leaked token) can't inflate the count or grow the table
 * without bound — in-memory and per PM2 worker, which is fine because
 * exact counts don't matter here and a real finder's re-scans are minutes
 * apart.
 *
 * Best-effort throughout: a write failure must never stop the finder from
 * reading the message they walked up to.
 */
const SCAN_LOG_THROTTLE_MS = 10_000;
const lastScanLoggedAt = new Map<number, number>();

export async function registerDropScan(itemId: number): Promise<void> {
  const now = Date.now();
  const prev = lastScanLoggedAt.get(itemId);
  if (prev !== undefined && now - prev < SCAN_LOG_THROTTLE_MS) return;
  lastScanLoggedAt.set(itemId, now);

  try {
    await prisma.$transaction([
      prisma.dropScan.create({ data: { itemId } }),
      // `foundAt: null` in the WHERE makes this a no-op on every scan but
      // the first, so the "found" moment is the moment somebody actually
      // picked the card up — later scans don't move it.
      prisma.dropItem.updateMany({
        where: { id: itemId, foundAt: null },
        data: { foundAt: new Date(), status: DropStatus.FOUND },
      }),
    ]);
  } catch {
    /* swallow — the landing page renders regardless */
  }
}
