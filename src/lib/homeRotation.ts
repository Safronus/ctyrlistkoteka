import { z } from "zod";

/**
 * Home-page rotation durations — admin-tunable intervals (in SECONDS)
 * for the three rotating surfaces on `/`:
 *   - the hero clover-fact card ("lístečky"),
 *   - the random-clover showcase widget,
 *   - the full-screen screensaver launched from that widget.
 *
 * This module holds only the CLIENT-SAFE pieces (bounds, defaults,
 * types, the input schema) so the admin form can import them without
 * dragging `node:fs` into the browser bundle. The filesystem read/write
 * lives in `homeRotation.server.ts`.
 */

/** Inclusive second bounds per duration — clamp absurd values from the
 *  form or a hand-edited file. */
export const HOME_ROTATION_BOUNDS = {
  cloverFactSeconds: { min: 5, max: 3600 },
  randomFindSeconds: { min: 5, max: 3600 },
  screensaverSeconds: { min: 2, max: 600 },
} as const;

export const HOME_ROTATION_DEFAULTS = {
  cloverFactSeconds: 120,
  randomFindSeconds: 60,
  screensaverSeconds: 10,
} as const;

export interface HomeRotationSettings {
  cloverFactSeconds: number;
  randomFindSeconds: number;
  screensaverSeconds: number;
}

export type RotationKey = keyof typeof HOME_ROTATION_BOUNDS;

/** Strict per-field schema (integer within bounds) — used by the admin
 *  action to validate form input and reject out-of-range values. */
function boundedField(key: RotationKey) {
  return z
    .number()
    .int()
    .min(HOME_ROTATION_BOUNDS[key].min)
    .max(HOME_ROTATION_BOUNDS[key].max);
}

export const homeRotationInputSchema = z.object({
  cloverFactSeconds: boundedField("cloverFactSeconds"),
  randomFindSeconds: boundedField("randomFindSeconds"),
  screensaverSeconds: boundedField("screensaverSeconds"),
});
