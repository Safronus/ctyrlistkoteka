/**
 * A clover drawn in SVG — three or four heart-shaped leaves around a centre
 * plus a stem. Used by the 404 games, where a single four-leaf hides among
 * three-leaf ones, so the two must differ ONLY in the leaf count: same size,
 * same colour, same stem. A `bud` (later rounds) is a decoy: a three-leaf
 * with a tiny fourth leaf just starting, close enough to fool a quick look.
 */

// One heart-shaped leaf with its tip at the origin, lobes pointing up.
const LEAF =
  "M0 0 C -7 -4 -12 -13 -6.5 -18 C -3 -21 0 -18.5 0 -16 C 0 -18.5 3 -21 6.5 -18 C 12 -13 7 -4 0 0 Z";

export function CloverShape({
  leaves,
  bud = false,
  rotate = 0,
  className,
  style,
}: {
  leaves: 3 | 4;
  bud?: boolean;
  /** Whole-clover rotation in degrees — varies the meadow so it looks grown. */
  rotate?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const step = 360 / leaves;
  // Three leaves sit like a Y, four like an X — the way they grow.
  const offset = leaves === 3 ? 0 : 45;
  return (
    <svg viewBox="-24 -24 48 48" className={className} style={style} aria-hidden focusable="false">
      <g transform={`rotate(${rotate})`}>
        <path
          d="M1 2 C 4 10 8 15 14 21"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        {Array.from({ length: leaves }, (_, i) => (
          <path key={i} d={LEAF} fill="currentColor" transform={`rotate(${offset + i * step})`} />
        ))}
        {bud && leaves === 3 && (
          <path d={LEAF} fill="currentColor" transform="rotate(60) scale(0.42)" />
        )}
        <circle r="2.2" fill="currentColor" opacity="0.35" />
      </g>
    </svg>
  );
}
