import { promises as fs } from "node:fs";
import path from "node:path";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import {
  HOME_ROTATION_BOUNDS,
  HOME_ROTATION_DEFAULTS,
  type HomeRotationSettings,
  type RotationKey,
} from "./homeRotation";

/**
 * Server-only filesystem side of the home-rotation settings. The values
 * live in a tiny JSON under `data/.admin/` (admin-internal config, next
 * to the backups dir — not collection data), atomically written by the
 * admin settings action and read here by the home page, which passes
 * the durations down to the client widgets as props.
 */

export const HOME_ROTATION_DIR = path.dirname(ADMIN_ROOTS.backups);
export const HOME_ROTATION_PATH = path.join(
  HOME_ROTATION_DIR,
  "home-rotation.json",
);

/** Coerce one stored value to an in-bounds integer, falling back to the
 *  default when it's missing / not a finite number. Lenient on read so a
 *  partial or slightly stale file still loads. */
function clampStored(value: unknown, key: RotationKey): number {
  const def = HOME_ROTATION_DEFAULTS[key];
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : def;
  const { min, max } = HOME_ROTATION_BOUNDS[key];
  return Math.min(max, Math.max(min, n));
}

/** Read the current rotation settings (seconds). Missing file or bad
 *  JSON → built-in defaults; individual out-of-range fields are clamped.
 *  Never throws. */
export async function getHomeRotationSettings(): Promise<HomeRotationSettings> {
  try {
    const raw = await fs.readFile(HOME_ROTATION_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      cloverFactSeconds: clampStored(
        parsed.cloverFactSeconds,
        "cloverFactSeconds",
      ),
      randomFindSeconds: clampStored(
        parsed.randomFindSeconds,
        "randomFindSeconds",
      ),
      screensaverSeconds: clampStored(
        parsed.screensaverSeconds,
        "screensaverSeconds",
      ),
    };
  } catch {
    return { ...HOME_ROTATION_DEFAULTS };
  }
}
