import { prisma } from "@/lib/db";

/**
 * The hunt hint a find's in-the-wild card may publish.
 *
 * Only the hint text ever leaves the admin — never the coordinates, never
 * the status, never the landing token. The whole idea is that somebody who
 * found one card can go looking for the next by reading a clue, not by
 * opening a map of hiding places.
 *
 * Returns null unless the operator explicitly ticked "zveřejnit" on that
 * card, so an unfinished hint can sit in the admin without leaking.
 */
export interface PublishedDropHint {
  cs: string;
  en: string | null;
}

export async function getPublishedDropHint(
  findId: number,
): Promise<PublishedDropHint | null> {
  const item = await prisma.dropItem.findUnique({
    where: { findId },
    select: { hintPublished: true, hintCs: true, hintEn: true },
  });
  if (!item?.hintPublished) return null;
  const cs = item.hintCs?.trim();
  if (!cs) return null;
  return { cs, en: item.hintEn?.trim() || null };
}
