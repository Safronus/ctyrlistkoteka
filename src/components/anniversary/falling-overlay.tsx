/**
 * Generic full-viewport falling-particles overlay. The four anniversary
 * variants (first-find, #111, #666, birthday) compose this same shell
 * with different particle "kinds" — clovers, "1" digits, "6" digits,
 * confetti, cakes, smileys.
 *
 * Pure CSS keyframes, no JS RAF or canvas, deterministic per-index
 * variation so SSR and client markup match. Pointer-events:none, so
 * the overlay never blocks interaction with the page underneath.
 *
 * `prefers-reduced-motion: reduce` freezes every particle. We do NOT
 * hide them — keeping a static field of motifs still reads as festive,
 * just without the motion that bothers users with vestibular issues.
 */
import type { ReactNode } from "react";

export interface ParticleKind {
  /** Renders the visual at the given size in CSS px. The wrapping
   *  <span> handles position/animation; this just paints. */
  render: (size: number) => ReactNode;
  /** Relative frequency among kinds in the same overlay. Higher → more
   *  particles of this kind on screen. */
  weight: number;
  /** Per-kind size band. Particles within a kind interpolate across
   *  this range so density can vary even within one motif. */
  minSize: number;
  maxSize: number;
  /** Per-kind opacity ceiling. 0.95 reads as "solid", 0.6 as "soft". */
  opacityBase?: number;
}

interface Particle {
  id: number;
  kindIdx: number;
  left: number;
  size: number;
  duration: number;
  delay: number;
  sway: number;
  rotation: number;
  opacity: number;
}

// Distinct CSS class per overlay instance so two simultaneous overlays
// (e.g. the detail-page #111 vibe + a coincident anniversary effect)
// don't share keyframe identifiers and step on each other.
let cssIdCounter = 0;

export function FallingOverlay({
  kinds,
  count,
  zIndex = 50,
  /** Vertical-only flag for variants where horizontal swing reads as
   *  unnatural (e.g. tight digits without an aerodynamic shape). */
  noSway = false,
}: {
  kinds: ReadonlyArray<ParticleKind>;
  count: number;
  zIndex?: number;
  noSway?: boolean;
}) {
  // Stable per-instance id — the constant counter is fine on the
  // server because the module evaluates once per request boundary in
  // a fresh module graph; on the client it survives across navigation
  // but the values stay distinct.
  const instanceId = ++cssIdCounter;
  const animName = `ctyr-anniv-fall-${instanceId}`;
  const particleCls = `ctyr-anniv-particle-${instanceId}`;

  const totalWeight = kinds.reduce((s, k) => s + k.weight, 0) || 1;

  // Deterministic particle distribution. Prime-modulo over the index
  // gives pseudo-random-looking placement without needing Math.random
  // (which would diverge between server and client renders).
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    // Pick kind by weighted ladder over a coprime modulo of the index.
    const r = (i * 1009) % totalWeight;
    let acc = 0;
    let kindIdx = 0;
    for (let j = 0; j < kinds.length; j++) {
      acc += kinds[j]!.weight;
      if (r < acc) {
        kindIdx = j;
        break;
      }
    }
    const kind = kinds[kindIdx]!;
    const sizeStep = (i % 4) / 3; // 0, 1/3, 2/3, 1 …
    const size = kind.minSize + sizeStep * (kind.maxSize - kind.minSize);
    particles.push({
      id: i,
      kindIdx,
      left: (i * 7919) % 100,
      size,
      duration: 10 + (i % 8),
      delay: -((i * 1.3) % 12),
      sway: noSway ? 0 : ((i % 5) - 2) * 25,
      rotation: 360 + ((i % 3) - 1) * 180,
      opacity: (kind.opacityBase ?? 0.85) - (i % 5) * 0.06,
    });
  }

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 overflow-hidden"
      style={{ zIndex }}
    >
      <style>{`
        @keyframes ${animName} {
          0%   { transform: translate3d(0, -10vh, 0) rotate(0deg); opacity: 0; }
          6%   { opacity: var(--p-opacity, 0.85); }
          50%  { transform: translate3d(var(--p-sway, 0px), 50vh, 0) rotate(calc(var(--p-rot, 360deg) * 0.5)); }
          94%  { opacity: var(--p-opacity, 0.85); }
          100% { transform: translate3d(calc(var(--p-sway, 0px) * -0.6), 110vh, 0) rotate(var(--p-rot, 360deg)); opacity: 0; }
        }
        .${particleCls} {
          position: absolute;
          top: 0;
          will-change: transform, opacity;
          animation-name: ${animName};
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .${particleCls} {
            animation-play-state: paused !important;
          }
        }
      `}</style>

      {particles.map((p) => (
        <span
          key={p.id}
          className={particleCls}
          style={
            {
              left: `${p.left}%`,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              "--p-sway": `${p.sway}px`,
              "--p-rot": `${p.rotation}deg`,
              "--p-opacity": p.opacity.toFixed(2),
            } as React.CSSProperties
          }
        >
          {kinds[p.kindIdx]!.render(p.size)}
        </span>
      ))}
    </div>
  );
}
