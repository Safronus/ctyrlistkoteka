/**
 * Quiet full-viewport overlay for LOST finds — the "it drifts away" half
 * of the lost-find treatment (the other half being the muted gallery
 * photos + the banner above the photo). A sparse shower of little grey
 * ghosts RISES from the bottom edge, sways, shrinks and dissolves to
 * nothing about two thirds of the way up — reads as a quiet elegy, not a
 * celebration. (Anonymized finds get the same motion with question
 * marks; the two can stack.)
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
            <path
              d="M12 2C7.6 2 4 5.6 4 10v12l3-3 3 3 2-2 2 2 3-3 3 3V10c0-4.4-3.6-8-8-8z"
              fill="#cbd5e1"
            />
            <circle cx={9.2} cy={10} r={1.3} fill="#64748b" />
            <circle cx={14.8} cy={10} r={1.3} fill="#64748b" />
          </svg>
        </span>
      ))}
    </div>
  );
}
