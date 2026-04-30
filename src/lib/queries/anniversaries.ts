/**
 * Lookup of "foundAt" for the small set of finds that drive the
 * site-wide easter-egg overlays — see CLAUDE.md and the
 * AnniversaryOverlay component. Returned as `MM-DD` strings in the
 * project's home timezone (Europe/Prague) so the client overlay can
 * trivially compare against the visitor's "today" without dragging a
 * date library across the wire.
 *
 * Anonymized special-finds intentionally still resolve here — the day
 * (MM-DD) of a Find isn't itself private; CLAUDE.md §6 only restricts
 * notes/coordinates/exact title. The overlay never names which find it
 * celebrates, just sprinkles particles, so leaking nothing.
 */
import { cache } from "react";
import { prisma } from "@/lib/db";

const ANNIVERSARY_IDS = [1, 111, 666] as const;
const TZ = "Europe/Prague";

export interface AnniversaryDates {
  /** MM-DD of find #1 — drives the "first find" anniversary overlay. */
  firstFindMD: string | null;
  /** MM-DD of find #111 — drives the heavenly clover-shower overlay. */
  jubilee111MD: string | null;
  /** MM-DD of find #666 — drives the hellish red-six + ember overlay. */
  jubilee666MD: string | null;
}

function toMonthDay(date: Date | null | undefined): string | null {
  if (!date) return null;
  // en-CA locale produces YYYY-MM-DD ordering, then we slice to MM-DD —
  // Intl avoids any UTC vs local-time ambiguity by accepting `timeZone`.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  // parts looks like "2018-05-12" — drop the year.
  return parts.slice(5);
}

/**
 * Single tiny query — `findMany` against the primary key index, three
 * rows max. Wrapped in `cache()` so multiple sections of a single
 * request that consult the result share the SQL roundtrip.
 */
export const getAnniversaryDates = cache(
  async (): Promise<AnniversaryDates> => {
    const rows = await prisma.find.findMany({
      where: { id: { in: [...ANNIVERSARY_IDS] } },
      select: { id: true, foundAt: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r.foundAt]));
    return {
      firstFindMD: toMonthDay(byId.get(1)),
      jubilee111MD: toMonthDay(byId.get(111)),
      jubilee666MD: toMonthDay(byId.get(666)),
    };
  },
);
