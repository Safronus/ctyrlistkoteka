/**
 * Quiet full-viewport overlay for DONATED finds — the "it brings luck to
 * someone else" half of the donated treatment. A sparse shower of little
 * gift boxes and green clovers RISES from the bottom edge, sways, shrinks
 * and dissolves about two thirds of the way up. Same gentle motion as the
 * LOST / ANONYMIZED overlays but with its own particle seed so, when a
 * find carries several states, the different icons don't ride on top of
 * one another.
 *
 * Pure CSS keyframes (no canvas/RAF), pointer-events:none, and every
 * particle freezes under `prefers-reduced-motion: reduce`. Deterministic
 * per-index variation keeps the SSR markup stable (no hydration drift).
 */

const PARTICLES = 12;

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
  gift: boolean;
}

// Distinct seed from the lost / anonymized overlays (different multiplier
// and offset) so gifts, clovers, ghosts and question marks never share a
// column and read as separate showers.
const SPECS: RiseSpec[] = Array.from({ length: PARTICLES }, (_, i) => ({
  id: i,
  left: (i * 6247 + 53) % 100,
  size: 13 + (i % 4) * 3,
  duration: 12 + (i % 5),
  delay: -((i * 2.9 + 3) % 13),
  sway: ((i % 5) - 2) * 28,
  rotation: 160 + ((i % 3) - 1) * 110,
  rise: 56 + (i % 4) * 8,
  opacity: 0.4 + (i % 4) * 0.1,
  gift: i % 2 === 0,
}));

export function DonatedOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      <style>{`
        @keyframes ctyr-donated-rise {
          0%   { transform: translate3d(0, 0, 0) rotate(0deg) scale(1); opacity: 0; }
          8%   { opacity: var(--op, 0.5); }
          50%  { transform: translate3d(var(--sway, 0px), calc(var(--rise, -65vh) * 0.5), 0) rotate(calc(var(--rot, 160deg) * 0.5)) scale(0.85); }
          72%  { opacity: 0; }
          100% { transform: translate3d(calc(var(--sway, 0px) * -0.4), var(--rise, -65vh), 0) rotate(var(--rot, 160deg)) scale(0.5); opacity: 0; }
        }
        .ctyr-donated-riser {
          position: absolute; bottom: -6vh; will-change: transform, opacity;
          animation-name: ctyr-donated-rise;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .ctyr-donated-riser { animation-play-state: paused !important; }
        }
      `}</style>

      {SPECS.map((c) => (
        <span
          key={c.id}
          className="ctyr-donated-riser"
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
          {c.gift ? (
            <svg width={c.size} height={c.size} viewBox="0 0 24 24" aria-hidden>
              <rect x={4} y={10} width={16} height={10} rx={1} fill="#e8a33d" />
              <rect
                x={3.5}
                y={8}
                width={17}
                height={3}
                rx={0.8}
                fill="#f0b455"
              />
              <rect x={10.5} y={8} width={3} height={12} fill="#c0392b" />
              <circle cx={9.5} cy={6.5} r={2} fill="#c0392b" />
              <circle cx={14.5} cy={6.5} r={2} fill="#c0392b" />
            </svg>
          ) : (
            <svg width={c.size} height={c.size} viewBox="0 0 24 24" aria-hidden>
              <g fill="#4d9748">
                <circle cx={12} cy={6} r={4.5} />
                <circle cx={6} cy={12} r={4.5} />
                <circle cx={18} cy={12} r={4.5} />
                <circle cx={12} cy={18} r={4.5} />
              </g>
              <circle cx={12} cy={12} r={2.5} fill="#3a7236" />
            </svg>
          )}
        </span>
      ))}
    </div>
  );
}
