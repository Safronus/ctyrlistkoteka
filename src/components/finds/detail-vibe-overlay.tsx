import { HeavenlyOverlay } from "./heavenly-overlay";
import { HellishOverlay } from "./hellish-overlay";
import { RecordOverlay } from "./record-overlay";
import { isRecordFind } from "@/lib/constants";

/** Special-find IDs paired with their dedicated atmospheric overlays.
 *  Keep this map small — adding entries for every "interesting" id
 *  would clutter the detail page. The 111/666 pair was a deliberate
 *  good/evil contrast asked for by the project owner. */
const VIBE_BY_ID: ReadonlyMap<number, "heavenly" | "hellish"> = new Map([
  [111, "heavenly"],
  [666, "hellish"],
]);

/**
 * Picks the right atmospheric overlay for a given find id, or renders
 * nothing for ordinary finds. Server component — the overlays
 * themselves are pure CSS and don't need client-side state.
 */
export function DetailVibeOverlay({ id }: { id: number }) {
  // The Czech-record find takes precedence over the id-pattern vibes.
  if (isRecordFind(id)) return <RecordOverlay />;
  const vibe = VIBE_BY_ID.get(id);
  if (vibe === "heavenly") return <HeavenlyOverlay />;
  if (vibe === "hellish") return <HellishOverlay />;
  return null;
}

/** Truth check used by the detail page to wrap article content in a
 *  hellish dark gradient when the find is #666. Co-located so adding a
 *  third "vibe" later (or moving the special handling elsewhere) only
 *  touches one map. */
export function isHellishFind(id: number): boolean {
  return VIBE_BY_ID.get(id) === "hellish";
}
