/**
 * A column chart as plain SVG, rendered on the server.
 *
 * One series, one hue (the brand's red), so no legend; columns capped at
 * 24 px with a 4 px rounded cap and a square foot on the baseline; a
 * hairline grid at three round ticks; labels in text tokens, never in
 * the data colour. Each column carries a <title>, which every browser
 * shows on hover — a tooltip with no script.
 */
export function Columns({
  values,
  labels,
  titles,
  width,
  height,
  every = 1,
}: {
  values: number[];
  /** Axis label per column; shown for every `every`-th one. */
  labels: string[];
  /** Hover text per column. */
  titles: string[];
  width: number;
  height: number;
  every?: number;
}) {
  const padL = 36;
  const padR = 8;
  const padT = 12;
  const padB = 22;
  const iw = width - padL - padR;
  const ih = height - padT - padB;
  const max = Math.max(1, ...values);
  const n = values.length;
  const slot = iw / n;
  const bw = Math.min(24, Math.max(4, Math.floor(slot - 2)));
  const ticks = niceTicks(max);
  const y = (v: number) => padT + ih - (v / ticks[ticks.length - 1]!) * ih;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Sloupcový graf"
      className="block"
      style={{ fontFamily: "inherit" }}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeWidth="1" />
          <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#9ca3af" className="tabular-nums">
            {t.toLocaleString("cs-CZ")}
          </text>
        </g>
      ))}
      <line x1={padL} x2={width - padR} y1={padT + ih} y2={padT + ih} stroke="#d1d5db" strokeWidth="1" />
      {values.map((v, i) => {
        const x = padL + i * slot + (slot - bw) / 2;
        const bh = (v / ticks[ticks.length - 1]!) * ih;
        const r = Math.min(4, bh);
        const top = padT + ih - bh;
        const d =
          bh <= 0
            ? ""
            : `M${x.toFixed(1)} ${(padT + ih).toFixed(1)} v${(-(bh - r)).toFixed(1)} a${r} ${r} 0 0 1 ${r} ${-r} h${(bw - 2 * r).toFixed(1)} a${r} ${r} 0 0 1 ${r} ${r} v${(bh - r).toFixed(1)} z`;
        return (
          <g key={i}>
            {/* A hit area taller than the column so an empty day still
                answers a hover. */}
            <rect x={x - 1} y={padT} width={bw + 2} height={ih} fill="transparent">
              <title>{titles[i]}</title>
            </rect>
            {d && (
              <path d={d} fill="#EF4635" style={{ pointerEvents: "none" }}>
                <title>{titles[i]}</title>
              </path>
            )}
            {i % every === 0 && (
              <text x={x + bw / 2} y={height - 6} textAnchor="middle" fontSize="11" fill="#6b7280">
                {labels[i]}
              </text>
            )}
            {v > 0 && v === max && (
              <text x={x + bw / 2} y={top - 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="#111827" className="tabular-nums">
                {v.toLocaleString("cs-CZ")}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** 0, a clean middle and a clean top at or above `max`. */
function niceTicks(max: number): number[] {
  const raw = max / 2;
  const mag = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  return [0, step, step * 2];
}
