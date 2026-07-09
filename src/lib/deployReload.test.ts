import { describe, expect, it } from "vitest";
import {
  DEPLOY_RELOAD_MIN_DELAY_MS,
  DEPLOY_RELOAD_MIN_GAP_MS,
  nextReloadDelayMs,
} from "./deployReload";

const NOW = 1_000_000_000;

describe("nextReloadDelayMs", () => {
  it("uses the min delay on a fresh landing (no prior reload)", () => {
    expect(nextReloadDelayMs(0, NOW)).toBe(DEPLOY_RELOAD_MIN_DELAY_MS);
  });

  it("waits the full gap when a reload just happened", () => {
    // This is the case the old code froze on: right after an auto-reload,
    // it must schedule the NEXT one ~20 s out, not return early.
    expect(nextReloadDelayMs(NOW, NOW)).toBe(DEPLOY_RELOAD_MIN_GAP_MS);
  });

  it("counts down the remaining gap partway through the window", () => {
    // 5 s since the last reload → 15 s left until the 20 s gap elapses.
    expect(nextReloadDelayMs(NOW - 5_000, NOW)).toBe(15_000);
  });

  it("never drops below the min delay near the window edge", () => {
    // 18 s in → 2 s of gap left, but the floor keeps it at 4 s.
    expect(nextReloadDelayMs(NOW - 18_000, NOW)).toBe(
      DEPLOY_RELOAD_MIN_DELAY_MS,
    );
  });

  it("uses the min delay once the gap window has fully passed", () => {
    expect(nextReloadDelayMs(NOW - 25_000, NOW)).toBe(
      DEPLOY_RELOAD_MIN_DELAY_MS,
    );
  });

  it("clamps a backwards clock to the full gap rather than overshooting", () => {
    // lastReloadAt in the future (clock skew) must not produce a >gap delay.
    expect(nextReloadDelayMs(NOW + 5_000, NOW)).toBe(DEPLOY_RELOAD_MIN_GAP_MS);
  });

  it("always returns at least the min delay", () => {
    for (const last of [0, NOW - 1, NOW, NOW - 19_999, NOW - 100_000]) {
      expect(nextReloadDelayMs(last, NOW)).toBeGreaterThanOrEqual(
        DEPLOY_RELOAD_MIN_DELAY_MS,
      );
    }
  });
});
