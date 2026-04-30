/**
 * Particle renderers — small SVGs / styled spans / emoji glyphs used
 * as motifs by the four anniversary overlays. Each renderer takes a
 * size and returns a React node sized to fit `size × size` so the
 * surrounding `<FallingOverlay>` layout math works identically across
 * kinds.
 *
 * SVGs preferred over emoji where we want a consistent look across
 * platforms (clovers, digits, confetti). Emoji only used where the
 * cross-platform variation is *welcome* — a 🎂 cake or 😊 smiley reads
 * fine in Apple/Win/Android even if rendered slightly differently.
 */
import type { ReactNode } from "react";

/** Brand-green four-leaf clover. Same shape as the find sprite. */
export function CloverParticle(size: number): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <g fill="#15803d">
        <circle cx={12} cy={6} r={4.5} />
        <circle cx={6} cy={12} r={4.5} />
        <circle cx={18} cy={12} r={4.5} />
        <circle cx={12} cy={18} r={4.5} />
      </g>
      <circle cx={12} cy={12} r={2.5} fill="#0f6e34" />
    </svg>
  );
}

/** Bold "#1" badge — emerald variant for the first-find anniversary.
 *  Two-character glyph so the wrapping span needs ~1.5× width vs. a
 *  single digit; font sized down so the visual weight stays close to
 *  the bare-clover sprites it falls alongside. */
export function HashOneParticle(size: number): ReactNode {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size * 1.5,
        height: size,
        fontSize: size * 0.85,
        fontWeight: 800,
        color: "#15803d",
        textShadow: "0 0 6px rgba(21, 128, 61, 0.45)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        lineHeight: 1,
      }}
    >
      #1
    </span>
  );
}

/** Bold "6" digit in red with a soft red glow — site-wide #666 day
 *  overlay. Brand-red (rose-700) instead of pure red so it reads as
 *  "warning red" rather than alert red. */
export function DigitSixParticle(size: number): ReactNode {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        fontSize: size * 0.95,
        fontWeight: 800,
        color: "#b91c1c",
        textShadow: "0 0 6px rgba(220, 38, 38, 0.55)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        lineHeight: 1,
      }}
    >
      6
    </span>
  );
}

/** Tiny coloured rectangle with a slight rotation — birthday confetti.
 *  The colour cycles through five festive hues (deterministic by the
 *  sentinel index passed in via `colorIdx`). */
const CONFETTI_COLORS = [
  "#ec4899", // pink-500
  "#f59e0b", // amber-500
  "#3b82f6", // blue-500
  "#10b981", // emerald-500
  "#a855f7", // purple-500
];

/** Returns a confetti-renderer parameterised by colour index, so the
 *  caller can pre-bake several flavours and add them to a kinds array
 *  with separate weights. Cycling colours through one renderer would
 *  make all confetti the same hue per particle index. */
export function makeConfettiParticle(colorIdx: number) {
  const color = CONFETTI_COLORS[colorIdx % CONFETTI_COLORS.length] ?? "#f472b6";
  function ConfettiParticle(size: number): ReactNode {
    return (
      <span
        style={{
          display: "inline-block",
          width: size * 0.55,
          height: size,
          background: color,
          borderRadius: 1,
          boxShadow: `0 0 4px ${color}55`,
        }}
      />
    );
  }
  return ConfettiParticle;
}

/** Cake emoji — used by the birthday variant only. */
export function CakeParticle(size: number): ReactNode {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        fontSize: size * 0.95,
        lineHeight: 1,
      }}
    >
      🎂
    </span>
  );
}

/** Returns a particle renderer that paints the project owner's
 *  photo watermark (the smiley used as a vodoznak on collection
 *  photos and on the home-page hero) at the requested size.
 *  Parameterised by URL because the watermark file lives outside
 *  `public/` and is served by an API route — the layout passes the
 *  resolved `/api/watermark` URL down at render time. The factory
 *  approach keeps the kind list easy to spread/weight while making
 *  the URL injection explicit. */
export function makeWatermarkSmileyParticle(src: string) {
  function WatermarkSmileyParticle(size: number): ReactNode {
    return (
      // Plain <img> mirrors the home page — Nginx serves the bytes
      // and Next/Image's optimizer would just add latency for a tiny
      // overlay sprite that doesn't need transformation.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        aria-hidden
        width={size}
        height={size}
        className="theme-invertible"
        style={{
          width: size,
          height: size,
          objectFit: "contain",
        }}
      />
    );
  }
  return WatermarkSmileyParticle;
}
