/**
 * Quiet full-viewport overlay for ANONYMIZED finds — the visual twin of
 * the LOST `LostOverlay`, but a sparse shower of small purple question
 * marks RISES from the bottom edge, sways, shrinks and dissolves about
 * two thirds of the way up. It reads as "this one keeps its secret".
 *
 * Pure CSS keyframes (no canvas/RAF), pointer-events:none, and every
 * particle freezes under `prefers-reduced-motion: reduce`. Deterministic
 * per-index variation keeps the SSR markup stable (no hydration drift).
 */

const MARKS = 12;

interface RiseSpec {
  id: number;
  left: number;
  size: number;
  duration: number;
  delay: number;
  sway: number;
  rotation: number;
  rise: number;
  opacity: number;
}

// Distinct seed from the LOST overlay (different multiplier/offset and
// timing) so ghosts and question marks never share a column — on an
// anonymized + lost find the two showers read as separate, not fused.
const SPECS: RiseSpec[] = Array.from({ length: MARKS }, (_, i) => ({
  id: i,
  left: (i * 5237 + 79) % 100,
  size: 14 + (i % 4) * 4,
  duration: 13 + (i % 5),
  delay: -((i * 3.3 + 7) % 15),
  sway: ((i % 5) - 2) * 26,
  rotation: 30 + ((i % 3) - 1) * 45,
  // How far up the particle gets before it has fully dissolved — varied
  // so the "vanishing line" isn't a visible horizontal band.
  rise: 60 + (i % 4) * 6,
  opacity: 0.3 + (i % 4) * 0.1,
}));

export function AnonymizedOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      <style>{`
        @keyframes ctyr-anon-rise {
          0%   { transform: translate3d(0, 0, 0) rotate(0deg) scale(1); opacity: 0; }
          8%   { opacity: var(--op, 0.4); }
          50%  { transform: translate3d(var(--sway, 0px), calc(var(--rise, -65vh) * 0.5), 0) rotate(calc(var(--rot, 30deg) * 0.5)) scale(0.85); }
          72%  { opacity: 0; }
          100% { transform: translate3d(calc(var(--sway, 0px) * -0.4), var(--rise, -65vh), 0) rotate(var(--rot, 30deg)) scale(0.5); opacity: 0; }
        }
        .ctyr-anon-riser {
          position: absolute; bottom: -6vh; will-change: transform, opacity;
          font-weight: 700; line-height: 1; color: #7e5bb5;
          animation-name: ctyr-anon-rise;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .ctyr-anon-riser { animation-play-state: paused !important; }
        }
      `}</style>

      {SPECS.map((c) => (
        <span
          key={c.id}
          className="ctyr-anon-riser"
          style={
            {
              left: `${c.left}%`,
              fontSize: `${c.size}px`,
              animationDuration: `${c.duration}s`,
              animationDelay: `${c.delay}s`,
              "--sway": `${c.sway}px`,
              "--rot": `${c.rotation}deg`,
              "--rise": `-${c.rise}vh`,
              "--op": c.opacity.toString(),
            } as React.CSSProperties
          }
        >
          ?
        </span>
      ))}
    </div>
  );
}
