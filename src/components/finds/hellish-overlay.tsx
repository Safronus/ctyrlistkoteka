/**
 * Full-viewport overlay rendered over the find detail for #666. Three
 * complementary effects compose the hellish atmosphere:
 *
 * 1. **Rising embers** — 30 small radial-gradient orbs floating up
 *    from the bottom edge, fading in/out and drifting sideways for
 *    organic motion.
 * 2. **Pulsing red vignette** — radial gradient at the screen edges
 *    that breathes in a 4 s loop, subtly tightening the visual frame.
 * 3. **Drifting smoke wisps** — three large blurred shadows moving
 *    horizontally over very long durations (40–55 s), reading as
 *    background smoke rather than active particles.
 *
 * Pure CSS keyframes (no canvas/RAF), pointer-events:none. Respects
 * `prefers-reduced-motion: reduce` by freezing every animated layer.
 */

const EMBERS = 30;
const ANIM_RISE = "ctyr-hellish-rise";
const ANIM_PULSE = "ctyr-hellish-pulse";
const ANIM_DRIFT = "ctyr-hellish-drift";

interface EmberSpec {
  id: number;
  /** Horizontal position as % of viewport width. */
  left: number;
  /** Ember diameter (px). */
  size: number;
  /** Rise duration (s). */
  duration: number;
  /** Animation delay (s, negative so embers start mid-loop). */
  delay: number;
  /** Sideways drift (px) at the apex of the rise. */
  drift: number;
  /** Per-ember opacity ceiling so the field doesn't read as a solid
   *  band of colour. */
  opacity: number;
}

const EMBER_SPECS: ReadonlyArray<EmberSpec> = Array.from(
  { length: EMBERS },
  (_, i) => ({
    id: i,
    left: (i * 6133) % 100,
    size: 4 + (i % 4) * 2,
    duration: 8 + (i % 6),
    delay: -((i * 1.4) % 10),
    drift: ((i % 5) - 2) * 18,
    opacity: 0.55 + (i % 5) * 0.08,
  }),
);

interface SmokeSpec {
  id: number;
  top: string;
  width: number;
  height: number;
  duration: number;
  delay: number;
  /** Direction multiplier — 1 (left→right) or -1 (right→left). */
  direction: 1 | -1;
}

const SMOKE_SPECS: ReadonlyArray<SmokeSpec> = [
  { id: 0, top: "20%", width: 360, height: 140, duration: 50, delay: 0, direction: 1 },
  { id: 1, top: "55%", width: 280, height: 120, duration: 42, delay: -18, direction: -1 },
  { id: 2, top: "78%", width: 320, height: 130, duration: 55, delay: -30, direction: 1 },
];

export function HellishOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      <style>{`
        @keyframes ${ANIM_RISE} {
          0%   { transform: translate3d(0, 5vh, 0) scale(0.85); opacity: 0; }
          12%  { opacity: var(--ember-opacity, 0.85); }
          60%  { transform: translate3d(var(--ember-drift, 0px), -55vh, 0) scale(1.12); }
          85%  { opacity: calc(var(--ember-opacity, 0.85) * 0.5); }
          100% { transform: translate3d(calc(var(--ember-drift, 0px) * 1.6), -110vh, 0) scale(0.45); opacity: 0; }
        }
        @keyframes ${ANIM_PULSE} {
          0%, 100% { opacity: 0.7; }
          50%      { opacity: 1; }
        }
        @keyframes ${ANIM_DRIFT} {
          0%   { transform: translate3d(calc(var(--smoke-from, -40vw) * 1), 0, 0); }
          100% { transform: translate3d(calc(var(--smoke-from, -40vw) * -1), 0, 0); }
        }
        .ctyr-hellish-ember {
          position: absolute;
          bottom: -2vh;
          border-radius: 9999px;
          will-change: transform, opacity;
          animation-name: ${ANIM_RISE};
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        .ctyr-hellish-vignette {
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse at center, transparent 30%, rgba(127, 29, 29, 0.55) 100%);
          will-change: opacity;
          animation: ${ANIM_PULSE} 4s ease-in-out infinite;
        }
        .ctyr-hellish-smoke {
          position: absolute;
          border-radius: 9999px;
          background: rgba(0, 0, 0, 0.28);
          filter: blur(36px);
          will-change: transform;
          animation-name: ${ANIM_DRIFT};
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .ctyr-hellish-ember,
          .ctyr-hellish-vignette,
          .ctyr-hellish-smoke {
            animation-play-state: paused !important;
          }
        }
      `}</style>

      <div className="ctyr-hellish-vignette" />

      {SMOKE_SPECS.map((s) => (
        <div
          key={s.id}
          className="ctyr-hellish-smoke"
          style={
            {
              top: s.top,
              width: `${s.width}px`,
              height: `${s.height}px`,
              animationDuration: `${s.duration}s`,
              animationDelay: `${s.delay}s`,
              animationDirection: s.direction === 1 ? "normal" : "reverse",
              "--smoke-from": "-40vw",
            } as React.CSSProperties
          }
        />
      ))}

      {EMBER_SPECS.map((ember) => (
        <span
          key={ember.id}
          className="ctyr-hellish-ember"
          style={
            {
              left: `${ember.left}%`,
              width: `${ember.size}px`,
              height: `${ember.size}px`,
              background:
                "radial-gradient(circle, rgba(252,165,165,0.95) 0%, rgba(220,38,38,0.55) 50%, transparent 100%)",
              animationDuration: `${ember.duration}s`,
              animationDelay: `${ember.delay}s`,
              "--ember-drift": `${ember.drift}px`,
              "--ember-opacity": ember.opacity.toString(),
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
