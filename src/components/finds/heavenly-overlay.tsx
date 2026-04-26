/**
 * Full-viewport overlay rendered over the find detail for #111. Drops
 * a continuous shower of brand-green clovers from the top of the
 * screen with per-leaf variation in size, fall duration, and sideways
 * swing so the field looks organic rather than gridded. Pure CSS
 * keyframes (no JS RAF loop, no canvas) to keep CPU/battery cost
 * close to zero. Pointer-events:none, so the user can interact with
 * the find detail underneath as usual.
 *
 * `prefers-reduced-motion: reduce` freezes the field — leaves stay at
 * a paused frame so the page stays visually intact for visitors who
 * opt out of animations.
 */

const LEAVES = 36;
const ANIM_NAME = "ctyr-heavenly-fall";

interface LeafSpec {
  id: number;
  /** Horizontal position as % of viewport width. */
  left: number;
  /** SVG sprite size in CSS px. */
  size: number;
  /** Fall duration (s). */
  duration: number;
  /** Animation delay (s, negative so leaves start mid-loop). */
  delay: number;
  /** Sideways sway magnitude (px) — half-amplitude in either direction. */
  sway: number;
  /** Final-rotation amount (deg). 360 = one full turn. */
  rotation: number;
  /** Subtle opacity variation so distant leaves look softer. */
  opacity: number;
}

// Deterministic per-index variation. Using prime-modulo keeps SSR
// markup stable (no Math.random hydration mismatch) while still
// looking sufficiently scattered.
const LEAF_SPECS: ReadonlyArray<LeafSpec> = Array.from(
  { length: LEAVES },
  (_, i) => ({
    id: i,
    left: (i * 7919) % 100,
    size: 12 + (i % 4) * 3,
    duration: 10 + (i % 8),
    delay: -((i * 1.3) % 12),
    sway: ((i % 5) - 2) * 25,
    rotation: 360 + ((i % 3) - 1) * 180,
    opacity: 0.55 + (i % 5) * 0.09,
  }),
);

export function HeavenlyOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      <style>{`
        @keyframes ${ANIM_NAME} {
          0%   { transform: translate3d(0, -10vh, 0) rotate(0deg); opacity: 0; }
          6%   { opacity: var(--leaf-opacity, 0.8); }
          50%  { transform: translate3d(var(--leaf-sway, 0px), 50vh, 0) rotate(calc(var(--leaf-rot, 360deg) * 0.5)); }
          94%  { opacity: var(--leaf-opacity, 0.8); }
          100% { transform: translate3d(calc(var(--leaf-sway, 0px) * -0.6), 110vh, 0) rotate(var(--leaf-rot, 360deg)); opacity: 0; }
        }
        .ctyr-heavenly-leaf {
          position: absolute;
          top: 0;
          will-change: transform, opacity;
          animation-name: ${ANIM_NAME};
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .ctyr-heavenly-leaf {
            animation-play-state: paused !important;
          }
        }
      `}</style>

      {LEAF_SPECS.map((leaf) => (
        <span
          key={leaf.id}
          className="ctyr-heavenly-leaf"
          style={
            {
              left: `${leaf.left}%`,
              animationDuration: `${leaf.duration}s`,
              animationDelay: `${leaf.delay}s`,
              "--leaf-sway": `${leaf.sway}px`,
              "--leaf-rot": `${leaf.rotation}deg`,
              "--leaf-opacity": leaf.opacity.toString(),
            } as React.CSSProperties
          }
        >
          <svg
            width={leaf.size}
            height={leaf.size}
            viewBox="0 0 24 24"
            aria-hidden
          >
            <g fill="#15803d">
              <circle cx={12} cy={6} r={4.5} />
              <circle cx={6} cy={12} r={4.5} />
              <circle cx={18} cy={12} r={4.5} />
              <circle cx={12} cy={18} r={4.5} />
            </g>
            <circle cx={12} cy={12} r={2.5} fill="#0f6e34" />
          </svg>
        </span>
      ))}
    </div>
  );
}
