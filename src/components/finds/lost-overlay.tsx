/**
 * Quiet full-viewport overlay for LOST finds — the "blown away by the
 * wind" half of the lost-find treatment (the other half being the muted
 * gallery photos + the dashed banner on the detail page). A sparse
 * shower of green clovers RISES from the bottom edge, sways, shrinks
 * and dissolves to nothing about two thirds of the way up — the
 * inverse of the heavenly #111 shower, with far fewer particles so it
 * reads as an elegy, not a celebration.
 *
 * Pure CSS keyframes (no canvas/RAF), pointer-events:none, and every
 * particle freezes under `prefers-reduced-motion: reduce`. Deterministic
 * per-index variation keeps the SSR markup stable (no hydration drift).
 */

const CLOVERS = 12;

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

const SPECS: RiseSpec[] = Array.from({ length: CLOVERS }, (_, i) => ({
  id: i,
  left: (i * 7919 + 41) % 100,
  size: 11 + (i % 4) * 3,
  duration: 11 + (i % 6),
  delay: -((i * 2.3) % 14),
  sway: ((i % 5) - 2) * 30,
  rotation: 180 + ((i % 3) - 1) * 120,
  // How far up the particle gets before it has fully dissolved —
  // varied so the "vanishing line" isn't a visible horizontal band.
  rise: 58 + (i % 4) * 7,
  opacity: 0.35 + (i % 4) * 0.1,
}));

export function LostOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      <style>{`
        @keyframes ctyr-lost-rise {
          0%   { transform: translate3d(0, 0, 0) rotate(0deg) scale(1); opacity: 0; }
          8%   { opacity: var(--op, 0.45); }
          50%  { transform: translate3d(var(--sway, 0px), calc(var(--rise, -65vh) * 0.5), 0) rotate(calc(var(--rot, 180deg) * 0.5)) scale(0.85); }
          72%  { opacity: 0; }
          100% { transform: translate3d(calc(var(--sway, 0px) * -0.4), var(--rise, -65vh), 0) rotate(var(--rot, 180deg)) scale(0.5); opacity: 0; }
        }
        .ctyr-lost-riser {
          position: absolute; bottom: -6vh; will-change: transform, opacity;
          animation-name: ctyr-lost-rise;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .ctyr-lost-riser { animation-play-state: paused !important; }
        }
      `}</style>

      {SPECS.map((c) => (
        <span
          key={c.id}
          className="ctyr-lost-riser"
          style={
            {
              left: `${c.left}%`,
              animationDuration: `${c.duration}s`,
              animationDelay: `${c.delay}s`,
              "--sway": `${c.sway}px`,
              "--rot": `${c.rotation}deg`,
              "--rise": `-${c.rise}vh`,
              "--op": c.opacity.toString(),
            } as React.CSSProperties
          }
        >
          <svg width={c.size} height={c.size} viewBox="0 0 24 24" aria-hidden>
            <g fill="#4d9748">
              <circle cx={12} cy={6} r={4.5} />
              <circle cx={6} cy={12} r={4.5} />
              <circle cx={18} cy={12} r={4.5} />
              <circle cx={12} cy={18} r={4.5} />
            </g>
            <circle cx={12} cy={12} r={2.5} fill="#3a7236" />
          </svg>
        </span>
      ))}
    </div>
  );
}
