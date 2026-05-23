import type { SVGProps } from "react";

/**
 * Composite "thumbs up inside a four-leaf clover" icon. Two layers:
 *
 *   1. Background — four overlapping circles forming the clover (each
 *      leaf is one disc). Drawn first with reduced opacity so the
 *      thumb on top reads clearly. When `filled` they're solidly
 *      coloured; otherwise they're a soft tinted halo.
 *
 *   2. Foreground — a chunky, lucide-style thumbs-up glyph centred on
 *      the icon. The thumb uses the same `currentColor`, so the whole
 *      icon picks up Tailwind `text-*` classes from the parent.
 *
 * v2: bigger viewBox (32) and chunkier strokes so the icon survives
 * being rendered at 16–20 px without collapsing into a `⌘`-shaped
 * blob (v1 issue spotted in production).
 *
 * Two variants:
 *   - `filled={false}` — outlined thumb on a soft clover halo
 *   - `filled={true}`  — filled thumb + saturated clover leaves
 */
export function CloverThumbIcon({
  filled = false,
  ...props
}: SVGProps<SVGSVGElement> & { filled?: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width="1em"
      height="1em"
      aria-hidden="true"
      {...props}
    >
      {/* Four-leaf clover: each leaf is a disc, arranged in a 2×2
       *  pattern around the centre (15.5, 15.5). The discs overlap
       *  the centre so they read as "joined" leaves rather than
       *  separate dots. Filled state stays soft (0.55) so the
       *  thumb glyph keeps its contrast — a fully saturated halo
       *  would drown the thumb. */}
      <g
        fill="currentColor"
        opacity={filled ? 0.55 : 0.18}
      >
        <circle cx="10" cy="10" r="7" />
        <circle cx="22" cy="10" r="7" />
        <circle cx="10" cy="22" r="7" />
        <circle cx="22" cy="22" r="7" />
      </g>
      {/* Small stem peeking out from the bottom — sells the clover
       *  silhouette over "four overlapping coins". */}
      <path
        d="M 16 26 Q 17 29 19 30"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        opacity={0.5}
      />
      {/* Thumbs-up glyph, centred. Geometry mirrors lucide-react's
       *  `ThumbsUp` but scaled down to ~15×15 viewBox units and
       *  positioned at translate(8.5, 9). The forearm rectangle is
       *  separate from the hand so the silhouette stays readable
       *  even at 16-px renders.
       *
       *  Outline mode: stroke only (no fill); filled mode: solid
       *  white fill over the saturated clover so the thumb pops. */}
      <g
        transform="translate(8.5 9)"
        fill={filled ? "#ffffff" : "none"}
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Forearm — small filled rectangle (or empty box when not
         *  voted). 3px wide, 7px tall, anchored bottom-left. */}
        <rect x="0" y="6" width="3.5" height="7.5" rx="0.6" />
        {/* Hand — palm + thumb fold. One closed path so the fill
         *  works cleanly. Starts at top-left of the palm, curves up
         *  over the thumb, then traces the cuff. */}
        <path d="M 3.5 6 L 6 1.7 Q 6.8 0.5 8 1 Q 9 1.5 8.4 3 L 7.5 6 L 12 6 Q 13.4 6 13 7.4 L 11.6 12.2 Q 11.3 13.5 10 13.5 L 4.4 13.5 Q 3.5 13.5 3.5 12.6 Z" />
      </g>
    </svg>
  );
}
