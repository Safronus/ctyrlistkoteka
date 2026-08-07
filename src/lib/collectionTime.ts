/**
 * The collection's own time zone, and the conversion EXIF forces on us.
 *
 * EXIF `DateTimeOriginal` is a bare wall-clock — "2026:05:13 20:39:53" with no
 * zone attached. Reading it with `new Date(y, m, d, …)` interprets it in the
 * PROCESS's zone, and the VPS runs in UTC, so a find made at 20:39 in Zlín was
 * stored as 20:39Z: two hours later than it happened. Rendering then hid it —
 * most surfaces formatted without an explicit zone, so they printed the value
 * back in UTC and the error cancelled out. Only the pages that did the right
 * thing (`/`, the find detail) showed the shift, which is why one page said
 * 22:39 and another 20:39 for the same find.
 *
 * The fix has to be applied on both sides at once: parse EXIF as Prague wall
 * clock, and format every timestamp in Prague explicitly. Fixing one alone
 * makes the visible times worse, not better.
 */

export const COLLECTION_TIME_ZONE = "Europe/Prague";

/** Zone offset in ms at a given instant — what `formatToParts` in the zone
 *  reports minus the instant itself. */
function offsetMs(instant: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(new Date(instant)).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    // "24" appears at midnight in the hour12:false formatter on some ICU
    // builds; fold it back to 0 so the arithmetic stays in range.
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - instant;
}

/**
 * The instant at which the given wall-clock reading happened in `timeZone`.
 *
 * Two passes: the first offset is looked up at the naive instant, which can be
 * on the wrong side of a DST switch; re-reading it at the corrected instant
 * settles the boundary cases. Verified against both Prague transitions and
 * against a process running in UTC as well as in Prague.
 */
export function instantFromWallClock(
  year: number,
  month1: number,
  day: number,
  hours: number,
  minutes: number,
  seconds: number,
  timeZone: string = COLLECTION_TIME_ZONE,
): Date {
  const naive = Date.UTC(year, month1 - 1, day, hours, minutes, seconds);
  const first = naive - offsetMs(naive, timeZone);
  return new Date(naive - offsetMs(first, timeZone));
}

/**
 * Reinterpret a Date that was built from a wall-clock reading in the process's
 * own zone (which is what every EXIF parser does) as that same wall clock in
 * the collection's zone. The local getters hand back exactly the components
 * the parser was given, so this works on the UTC VPS and on a Prague laptop
 * alike.
 */
export function reinterpretAsCollectionZone(d: Date): Date {
  return instantFromWallClock(
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  );
}
