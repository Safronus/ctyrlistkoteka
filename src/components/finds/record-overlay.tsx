/**
 * Full-viewport celebration overlay for the Czech-record find (the
 * largest four-leaf clover collection in ČR). A balanced blend of four
 * motifs, none of them dominating:
 *
 *  1. **Golden clover shower** — denser than the #111 heavenly field and
 *     in gold instead of green ("the record one").
 *  2. **Trophy + Czech-flag icons** — small falling trophies and tiny
 *     Czech flags (random sizes + positions) for the "national record"
 *     note, replacing the earlier plain tricolor confetti.
 *  3. **Sparkles** — a few gold twinkles.
 *  4. **Gold vignette** — a soft golden glow breathing at the edges.
 *
 * Pure CSS keyframes (no canvas/RAF), pointer-events:none, and every
 * layer freezes under `prefers-reduced-motion: reduce`. Deterministic
 * per-index variation keeps the SSR markup stable (no hydration drift).
 */

const CLOVERS = 22;
const TROPHIES = 7;
const FLAGS = 7;
const SPARKLES = 10;

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
const TROPHY_SPECS = fallSpecs(TROPHIES, 5);
const FLAG_SPECS = fallSpecs(FLAGS, 8);
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

      {/* Falling trophies */}
      {TROPHY_SPECS.map((c) => {
        const sz = c.size + 8; // 20–29 px — bigger than clovers, readable
        return (
          <span
            key={`t${c.id}`}
            className="ctyr-record-faller"
            style={
              {
                left: `${c.left}%`,
                animationDuration: `${c.duration + 1}s`,
                animationDelay: `${c.delay}s`,
                "--sway": `${c.sway}px`,
                "--rot": `${(((c.id % 3) - 1) * 24)}deg`,
                "--op": Math.min(c.opacity + 0.2, 1).toString(),
              } as React.CSSProperties
            }
          >
            <svg
              width={sz}
              height={sz}
              viewBox="0 0 24 24"
              fill="none"
              stroke="#a16207"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.15))" }}
            >
              <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
              <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
              <path d="M4 22h16" />
              <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
              <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
              <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
            </svg>
          </span>
        );
      })}

      {/* Falling Czech flags */}
      {FLAG_SPECS.map((c) => {
        const w = c.size + 10; // 22–31 px wide
        const h = Math.round(w * 0.667); // 3:2 flag ratio
        return (
          <span
            key={`f${c.id}`}
            className="ctyr-record-faller"
            style={
              {
                left: `${c.left}%`,
                animationDuration: `${c.duration + 2}s`,
                animationDelay: `${c.delay}s`,
                "--sway": `${c.sway * 1.2}px`,
                "--rot": `${(((c.id % 3) - 1) * 30)}deg`,
                "--op": "0.92",
              } as React.CSSProperties
            }
          >
            <svg
              width={w}
              height={h}
              viewBox="0 0 30 20"
              aria-hidden
              style={{
                borderRadius: 2,
                boxShadow: "0 0 0 1px rgba(0,0,0,0.12)",
              }}
            >
              <rect width={30} height={10} fill="#ffffff" />
              <rect y={10} width={30} height={10} fill="#d7141a" />
              <polygon points="0,0 15,10 0,20" fill="#11457e" />
            </svg>
          </span>
        );
      })}

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
