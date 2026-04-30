/**
 * Subset of the detail-page hellish overlay — just the rising embers,
 * no vignette and no smoke. Used as a second layer underneath the
 * falling red "6" particles on /sbirka/666's anniversary day. The
 * heavier vignette + smoke that work on a dedicated find detail are
 * too aggressive for site-wide all-day use.
 */

const EMBERS = 22;
const ANIM = "ctyr-anniv-rise";

interface EmberSpec {
  id: number;
  left: number;
  size: number;
  duration: number;
  delay: number;
  drift: number;
  opacity: number;
}

const EMBER_SPECS: ReadonlyArray<EmberSpec> = Array.from(
  { length: EMBERS },
  (_, i) => ({
    id: i,
    left: (i * 6133) % 100,
    size: 4 + (i % 4) * 2,
    duration: 9 + (i % 6),
    delay: -((i * 1.4) % 10),
    drift: ((i % 5) - 2) * 18,
    opacity: 0.45 + (i % 5) * 0.07,
  }),
);

export function RisingEmbersLayer({ zIndex = 49 }: { zIndex?: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 overflow-hidden"
      style={{ zIndex }}
    >
      <style>{`
        @keyframes ${ANIM} {
          0%   { transform: translate3d(0, 5vh, 0) scale(0.85); opacity: 0; }
          12%  { opacity: var(--ember-opacity, 0.5); }
          60%  { transform: translate3d(var(--ember-drift, 0px), -55vh, 0) scale(1.12); }
          85%  { opacity: calc(var(--ember-opacity, 0.5) * 0.5); }
          100% { transform: translate3d(calc(var(--ember-drift, 0px) * 1.6), -110vh, 0) scale(0.45); opacity: 0; }
        }
        .ctyr-anniv-ember {
          position: absolute;
          bottom: -2vh;
          border-radius: 9999px;
          will-change: transform, opacity;
          animation-name: ${ANIM};
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .ctyr-anniv-ember {
            animation-play-state: paused !important;
          }
        }
      `}</style>

      {EMBER_SPECS.map((ember) => (
        <span
          key={ember.id}
          className="ctyr-anniv-ember"
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
