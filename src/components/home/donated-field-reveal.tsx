"use client";

import { useState } from "react";
import type { ReactNode } from "react";

/**
 * The drifting-clovers visual with its "→ pole" affordance turned into a
 * toggle: clicking it reveals the field of already-donated clovers
 * (DonatedBoardSection) right below, between the drift and the running
 * total. Server-rendered pieces are passed in as props (`drift`, `field`)
 * so this thin client wrapper only owns the open/closed state — the field is
 * always in the DOM (good for crawlers), just hidden until opened.
 *
 * The pulsing clover reuses the `ctyr-land-pulse` keyframes emitted by
 * DriftClovers (CSS keyframes are global); the twinkle keyframes are local.
 */

/** The find-map clover (four heart leaves + dark outline + centre veins), as
 *  SVG — the same mark shown for finds on /mapa. */
const HEART =
  "M0 0 C-8 -5 -16.5 -13.5 -16.5 -22.5 C-16.5 -30.5 -12.5 -36 -7 -36 " +
  "C-3 -36 -1 -32 0 -27.5 C1 -32 3 -36 7 -36 C12.5 -36 16.5 -30.5 16.5 -22.5 " +
  "C16.5 -13.5 8 -5 0 0 Z";

function CloverLeaves({ fill }: { fill: string }) {
  return (
    <>
      {[45, 135, 225, 315].map((a) => (
        <path
          key={a}
          transform={`translate(50 50) rotate(${a})`}
          d={HEART}
          fill={fill}
        />
      ))}
    </>
  );
}

function CloverCentre({ fill }: { fill: string }) {
  return (
    <g transform="translate(50 50)" fill={fill}>
      {[0, 90, 180, 270].map((a) => (
        <path key={a} transform={`rotate(${a})`} d="M0 -27 L -2.6 -4 L 2.6 -4 Z" />
      ))}
      <circle cx="0" cy="0" r="5" />
    </g>
  );
}

function MapClover() {
  return (
    <svg
      viewBox="0 0 100 100"
      className="ctyr-land-clover h-12 w-12 drop-shadow"
      style={{ animation: "ctyr-land-pulse 2.4s ease-in-out infinite" }}
      aria-hidden
    >
      {/* dark outline underlay (scaled +18 %) */}
      <g transform="translate(50 50) scale(1.18) translate(-50 -50)">
        <path
          d="M50 49 q 3 15 12 20"
          fill="none"
          stroke="#0b5c2a"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
        <CloverLeaves fill="#0b5c2a" />
        <CloverCentre fill="#0b5c2a" />
      </g>
      {/* green fill + dark centre veins */}
      <path
        d="M50 49 q 3 15 12 20"
        fill="none"
        stroke="#15803d"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <CloverLeaves fill="#15803d" />
      <CloverCentre fill="#0b5c2a" />
    </svg>
  );
}

export function DonatedFieldReveal({
  drift,
  field,
}: {
  drift: ReactNode;
  field: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <style>{`
        @keyframes ctyr-twinkle {
          0%,100% { opacity: .25; transform: scale(.8) rotate(0deg); }
          50%     { opacity: 1;   transform: scale(1.15) rotate(22deg); }
        }
        @media (prefers-reduced-motion: reduce) { .ctyr-twinkle { animation: none !important; } }
      `}</style>
      <div className="relative mx-auto mt-1.5 w-full max-w-2xl">
        {drift}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={
            open
              ? "Skrýt pole darovaného štěstí"
              : "Kam padají? → Pole darovaného štěstí"
          }
          className="group absolute right-[6%] top-[58%] flex -translate-y-1/2 flex-col items-center gap-0.5 rounded-full p-1 transition hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <span className="relative block">
            <MapClover />
            {/* a little extra sparkle on the give-away affordance */}
            <span
              className="ctyr-twinkle pointer-events-none absolute -right-1 top-0 text-sm"
              style={{ animation: "ctyr-twinkle 1.9s ease-in-out infinite" }}
              aria-hidden
            >
              ✨
            </span>
          </span>
          <span className="text-[10px] font-semibold text-brand-700 opacity-70 group-hover:opacity-100">
            {open ? "× zavřít" : "→ pole"}
          </span>
        </button>
      </div>
      <div hidden={!open}>{field}</div>
    </>
  );
}
