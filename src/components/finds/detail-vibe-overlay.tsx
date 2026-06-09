import { HeavenlyOverlay } from "./heavenly-overlay";
import { HellishOverlay } from "./hellish-overlay";
import { RecordOverlay } from "./record-overlay";
import type { SpecialEffect } from "@/lib/specialFinds";

/**
 * Picks the atmospheric overlay for a find's resolved special effect, or
 * renders nothing for ordinary finds. The effect is resolved upstream
 * (find-detail page) from the admin-assignable special-find config — see
 * src/lib/specialFinds.* — so adding/moving an effect is a /admin action,
 * not a code change. Server component; the overlays are pure CSS.
 */
export function DetailVibeOverlay({
  effect,
}: {
  effect: SpecialEffect | null;
}) {
  if (effect === "record") return <RecordOverlay />;
  if (effect === "heavenly") return <HeavenlyOverlay />;
  if (effect === "hellish") return <HellishOverlay />;
  return null;
}
