import type { SVGProps } from "react";

/**
 * Composite "thumbs up inside a four-leaf clover" icon used by the
 * public vote button. The clover sits as a soft background (four
 * heart-shaped leaves around a central area); a smaller thumbs-up
 * stroke sits centred on top. The whole thing is a single inline SVG
 * so styling via CSS (color, fill, stroke) works the same as for any
 * lucide-react icon — `currentColor` picks up `text-*` Tailwind
 * classes from the parent.
 *
 * Sizing follows the lucide convention: `width`/`height` default to
 * "1em" so the icon scales with the surrounding font-size; callers
 * can override via the `className` (e.g. `h-5 w-5`).
 *
 * Two variants:
 *   - `filled={false}` — outlined clover + outlined thumb (the
 *     "not yet voted" state). Slight gap in the centre where the
 *     leaves meet, otherwise pure stroke.
 *   - `filled={true}`  — clover leaves filled with `currentColor`,
 *     thumb a darker hatched silhouette inside. The "voted" state.
 */
export function CloverThumbIcon({
  filled = false,
  ...props
}: SVGProps<SVGSVGElement> & { filled?: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* Four heart-shaped leaves arranged in NW / NE / SE / SW.
       *  Each leaf is one cubic curve that loops back to the centre.
       *  When `filled` we paint the leaves; otherwise they're hollow.
       *  The leaves are slightly translucent so the thumb on top can
       *  still read clearly without a heavy outline. */}
      <g
        fill={filled ? "currentColor" : "none"}
        fillOpacity={filled ? 0.35 : 1}
      >
        {/* NW leaf */}
        <path d="M12 12 C 9.5 11.5, 7 10, 6.5 7.5 C 6.2 5.8, 7.8 4.5, 9.3 5.3 C 10.4 5.9, 11.2 7.2, 12 8.8 Z" />
        {/* NE leaf */}
        <path d="M12 12 C 12.8 7.2, 14.7 5.3, 16.4 6.1 C 18 6.9, 17.9 9, 16.4 10.4 C 15.2 11.5, 13.7 11.9, 12 12 Z" />
        {/* SE leaf */}
        <path d="M12 12 C 14.5 12.5, 17 14, 17.5 16.5 C 17.8 18.2, 16.2 19.5, 14.7 18.7 C 13.6 18.1, 12.8 16.8, 12 15.2 Z" />
        {/* SW leaf */}
        <path d="M12 12 C 11.2 16.8, 9.3 18.7, 7.6 17.9 C 6 17.1, 6.1 15, 7.6 13.6 C 8.8 12.5, 10.3 12.1, 12 12 Z" />
      </g>
      {/* Tiny stem */}
      <path
        d="M12 12 L 12.5 18.5"
        strokeWidth={1.2}
        opacity={filled ? 0.45 : 0.55}
      />
      {/* Thumbs-up glyph in the centre — sized down to ~9×9 viewBox
       *  units so it sits inside the clover without crowding the
       *  leaves. Drawn manually because lucide's ThumbsUp is too big
       *  at this scale. */}
      <g transform="translate(7.6 7.6) scale(0.37)">
        <path
          d="M2 11h2.5v9H2z"
          fill={filled ? "currentColor" : "none"}
        />
        <path
          d="M4.5 11 L 7.5 6.5 C 8 5.5, 9 5, 10 5.5 C 11 6, 11 7, 10.5 8 L 9 11 H 14.5 C 15.6 11, 16.4 12, 16.1 13 L 14.7 18.5 C 14.4 19.5, 13.5 20, 12.5 20 H 5.5 C 4.7 20, 4.5 19.5, 4.5 18.7 V 11 Z"
          fill={filled ? "currentColor" : "none"}
          strokeWidth={1.8}
        />
      </g>
    </svg>
  );
}
