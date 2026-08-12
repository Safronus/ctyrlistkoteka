"use client";

import { useState } from "react";
import { Compass, TriangleAlert } from "lucide-react";

/**
 * The chain's one interactive bit: a button that uncovers the hint towards
 * the next clover.
 *
 * Behind a click rather than simply printed, because the point of the
 * chain is choosing to keep going — and because somebody who just wants
 * their own clover should not have the next hunt shoved at them.
 *
 * The text is delivered with the page and revealed in the browser. That is
 * on purpose: it is already gated by the thing that matters, which is
 * holding the previous card. What is never delivered is the next card's
 * coordinates or its token — the hint is prose like "u laviček v parku",
 * so the chain cannot be walked from a desk.
 */
export function ChainHint({
  findId,
  hint,
  alreadyFound,
  labels,
}: {
  findId: number;
  hint: string;
  alreadyFound: boolean;
  labels: {
    reveal: string;
    lead: string;
    found: string;
  };
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-6 rounded-xl border border-violet-200 bg-violet-50/70 p-4">
      {open ? (
        <>
          <p className="flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-800">
            <Compass className="h-3.5 w-3.5" aria-hidden />
            🍀 #{findId}
          </p>
          <p className="mt-2 whitespace-pre-line text-center text-sm leading-relaxed text-gray-800">
            {hint}
          </p>
          {alreadyFound && (
            <p className="mt-3 flex items-start justify-center gap-1.5 text-center text-xs text-amber-800">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {labels.found}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-center text-xs text-violet-900">{labels.lead}</p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-300 bg-white px-4 py-2.5 text-sm font-semibold text-violet-900 transition hover:bg-violet-100"
          >
            <Compass className="h-4 w-4" aria-hidden />
            {labels.reveal}
          </button>
        </>
      )}
    </div>
  );
}
