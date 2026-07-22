/**
 * Wall-clock–keyed rotation for the home-page clover-fact card.
 *
 * The card cycles through ~210 clover curiosities. Which one shows — and how
 * much of the countdown is left — is derived purely from the current time and
 * the (id-sorted) fact list, NOT from per-mount randomness. So every re-mount
 * at the same moment lands on the same fact with the same countdown.
 *
 * That's what makes a language switch calm: switching CS ⇄ EN is a full page
 * navigation here (see LocaleSwitcher), which re-mounts the card — but because
 * both locales compute the same slot from the same clock and the same facts,
 * the card just re-renders the current fact in the other language instead of
 * rotating to a fresh random one and restarting its timer.
 *
 *   slot   = floor(now / rotationMs)          — the window we're in
 *   index  = slotFactIndex(slot, n)           — a stable hashed spread, so
 *            consecutive slots differ but a given slot is fixed
 *   nextAt = (slot + 1) * rotationMs          — the instant the fact flips
 */

/** The rotation window index for a given instant. */
export function rotationSlot(nowMs: number, rotationMs: number): number {
  return Math.floor(nowMs / Math.max(1, rotationMs));
}

/**
 * Deterministic index in `[0, n)` for a rotation `slot`. A mulberry32-style
 * integer hash gives a uniform-ish spread, so successive slots show unrelated
 * facts while any single slot is perfectly reproducible across server and
 * every client.
 */
export function slotFactIndex(slot: number, n: number): number {
  if (n <= 1) return 0;
  let h = (slot ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h % n;
}
