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
 * DriftClovers (CSS keyframes are global), so no extra <style> is needed.
 */
function PoleClover() {
  return (
    <g fill="#15803d">
      <circle cx={0} cy={-5} r={4} />
      <circle cx={-5} cy={0} r={4} />
      <circle cx={5} cy={0} r={4} />
      <circle cx={0} cy={5} r={4} />
      <circle cx={0} cy={0} r={2.5} fill="#0f6e34" />
    </g>
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
          className="group absolute right-[6%] top-1/2 flex -translate-y-1/2 flex-col items-center gap-0.5 rounded-full p-1 transition hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <svg
            viewBox="-11 -11 22 22"
            className="ctyr-land-clover h-8 w-8 drop-shadow"
            style={{ animation: "ctyr-land-pulse 2.4s ease-in-out infinite" }}
            aria-hidden
          >
            <PoleClover />
          </svg>
          <span className="text-[9px] font-semibold text-brand-700 opacity-70 group-hover:opacity-100">
            {open ? "× zavřít" : "→ pole"}
          </span>
        </button>
      </div>
      <div hidden={!open}>{field}</div>
    </>
  );
}
