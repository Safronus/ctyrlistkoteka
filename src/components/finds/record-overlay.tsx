/**
 * Full-viewport celebration overlay for the Czech-record find (the
 * largest four-leaf clover collection in ČR). A balanced blend of four
 * motifs, none of them dominating:
 *
 *  1. **Golden clover shower** — denser than the #111 heavenly field and
 *     in gold instead of green ("the record one").
 *  2. **Czech tricolor confetti** — a sprinkle of white / red / blue
 *     pieces for the "national record" note.
 *  3. **Sparkles** — a few gold twinkles.
 *  4. **Gold vignette** — a soft golden glow breathing at the edges.
 *
 * Pure CSS keyframes (no canvas/RAF), pointer-events:none, and every
 * layer freezes under `prefers-reduced-motion: reduce`. Deterministic
 * per-index variation keeps the SSR markup stable (no hydration drift).
 */

const CLOVERS = 24;
const CONFETTI = 14;
const SPARKLES = 10;

const TRICOLOR = ["#ffffff", "#d7141a", "#11457e"]; // Czech flag

interface FallSpec {
  id: number;
  left: number;
  size: number;
  duration: number;
  delay: number;
  sway: number;
  rotation: number;
  opacity: number;
}

function fallSpecs(count: number, seed: number): FallSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: (i * 7919 + seed * 131) % 100,
    size: 12 + ((i + seed) % 4) * 3,
    duration: 9 + ((i + seed) % 8),
    delay: -(((i * 1.7 + seed) % 12)),
    sway: (((i + seed) % 5) - 2) * 26,
    rotation: 360 + (((i + seed) % 3) - 1) * 180,
    opacity: 0.5 + ((i + seed) % 5) * 0.1,
  }));
}

const CLOVER_SPECS = fallSpecs(CLOVERS, 0);
const CONFETTI_SPECS = fallSpecs(CONFETTI, 3);
const SPARKLE_SPECS = Array.from({ length: SPARKLES }, (_, i) => ({
  id: i,
  left: (i * 6131 + 17) % 100,
  top: (i * 4271 + 9) % 90,
  size: 10 + (i % 3) * 6,
  duration: 2.2 + (i % 4) * 0.6,
  delay: -((i * 0.7) % 3),
}));

export function RecordOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      <style>{`
        @keyframes ctyr-record-fall {
          0%   { transform: translate3d(0, -10vh, 0) rotate(0deg); opacity: 0; }
          6%   { opacity: var(--op, 0.8); }
          50%  { transform: translate3d(var(--sway, 0px), 50vh, 0) rotate(calc(var(--rot, 360deg) * 0.5)); }
          94%  { opacity: var(--op, 0.8); }
          100% { transform: translate3d(calc(var(--sway, 0px) * -0.6), 110vh, 0) rotate(var(--rot, 360deg)); opacity: 0; }
        }
        @keyframes ctyr-record-twinkle {
          0%, 100% { transform: scale(0.4); opacity: 0; }
          50%      { transform: scale(1); opacity: 0.9; }
        }
        @keyframes ctyr-record-glow {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 0.85; }
        }
        .ctyr-record-faller {
          position: absolute; top: 0; will-change: transform, opacity;
          animation-name: ctyr-record-fall;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        .ctyr-record-sparkle {
          position: absolute; will-change: transform, opacity;
          animation-name: ctyr-record-twinkle;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
        }
        .ctyr-record-glow {
          position: absolute; inset: 0;
          background:
            radial-gradient(120% 80% at 50% -10%, rgba(234,179,8,0.22), transparent 55%),
            radial-gradient(120% 80% at 50% 110%, rgba(234,179,8,0.18), transparent 55%);
          animation: ctyr-record-glow 5s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .ctyr-record-faller, .ctyr-record-sparkle, .ctyr-record-glow {
            animation-play-state: paused !important;
          }
        }
      `}</style>

      <div className="ctyr-record-glow" />

      {/* Golden clovers */}
      {CLOVER_SPECS.map((c) => (
        <span
          key={`c${c.id}`}
          className="ctyr-record-faller"
          style={
            {
              left: `${c.left}%`,
              animationDuration: `${c.duration}s`,
              animationDelay: `${c.delay}s`,
              "--sway": `${c.sway}px`,
              "--rot": `${c.rotation}deg`,
              "--op": c.opacity.toString(),
            } as React.CSSProperties
          }
        >
          <svg width={c.size} height={c.size} viewBox="0 0 24 24" aria-hidden>
            <g fill="#eab308">
              <circle cx={12} cy={6} r={4.5} />
              <circle cx={6} cy={12} r={4.5} />
              <circle cx={18} cy={12} r={4.5} />
              <circle cx={12} cy={18} r={4.5} />
            </g>
            <circle cx={12} cy={12} r={2.5} fill="#a16207" />
          </svg>
        </span>
      ))}

      {/* Czech tricolor confetti */}
      {CONFETTI_SPECS.map((c) => (
        <span
          key={`f${c.id}`}
          className="ctyr-record-faller"
          style={
            {
              left: `${c.left}%`,
              width: `${6 + (c.id % 3) * 2}px`,
              height: `${3 + (c.id % 2) * 2}px`,
              background: TRICOLOR[c.id % TRICOLOR.length],
              borderRadius: "1px",
              boxShadow: "0 0 1px rgba(0,0,0,0.15)",
              animationDuration: `${c.duration + 1}s`,
              animationDelay: `${c.delay}s`,
              "--sway": `${c.sway * 1.3}px`,
              "--rot": `${c.rotation * 2}deg`,
              "--op": "0.85",
            } as React.CSSProperties
          }
        />
      ))}

      {/* Gold sparkles */}
      {SPARKLE_SPECS.map((s) => (
        <span
          key={`s${s.id}`}
          className="ctyr-record-sparkle"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            animationDuration: `${s.duration}s`,
            animationDelay: `${s.delay}s`,
          }}
        >
          <svg width={s.size} height={s.size} viewBox="0 0 24 24" aria-hidden>
            <path
              d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z"
              fill="#fde68a"
            />
          </svg>
        </span>
      ))}
    </div>
  );
}
