/**
 * Auto-reload pacing for the deploy "updating…" scene (DeployScene).
 * Extracted as a pure function so the timing rule — the part that had a
 * freeze bug — is unit-testable without a browser.
 */

/** Minimum gap between consecutive auto-reloads, so a still-broken build
 *  can't spin the tab. */
export const DEPLOY_RELOAD_MIN_GAP_MS = 20_000;
/** Floor for the countdown, so a reload is never effectively instant even
 *  right at the edge of the gap window. Also the delay on a fresh landing. */
export const DEPLOY_RELOAD_MIN_DELAY_MS = 4_000;
/** Hard cap on auto-reloads per tab — past this the scene shows only the
 *  manual button (see willAutoReload) instead of looping forever. */
export const DEPLOY_MAX_AUTO_RELOADS = 10;

/**
 * Milliseconds until the next auto-reload.
 *
 * - Fresh landing (`lastReloadAt <= 0`) → {@link DEPLOY_RELOAD_MIN_DELAY_MS}.
 * - Otherwise → whatever keeps at least {@link DEPLOY_RELOAD_MIN_GAP_MS}
 *   between consecutive reloads, but never below the min delay.
 *
 * The countdown is driven off this SAME value, so it always ticks to zero
 * and fires — the old code returned early inside the gap window, freezing
 * the countdown with no reload scheduled.
 */
export function nextReloadDelayMs(lastReloadAt: number, nowMs: number): number {
  const sinceLast =
    lastReloadAt > 0 ? Math.max(0, nowMs - lastReloadAt) : Infinity;
  return Math.max(
    DEPLOY_RELOAD_MIN_DELAY_MS,
    DEPLOY_RELOAD_MIN_GAP_MS - sinceLast,
  );
}
