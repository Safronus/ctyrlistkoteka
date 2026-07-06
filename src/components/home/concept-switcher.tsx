"use client";

import { Children, useState } from "react";

/**
 * TEMPORARY debug switcher — renders a sticky toolbar that toggles between
 * the donation-area concept variants passed as children, so the layouts can
 * be compared live. Remove once a concept is chosen.
 */
export function ConceptSwitcher({
  labels,
  children,
}: {
  labels: string[];
  children: React.ReactNode;
}) {
  const items = Children.toArray(children);
  const [active, setActive] = useState(0);

  return (
    <div className="mt-6">
      <div className="sticky top-2 z-40 mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50/95 px-3 py-2 shadow-sm backdrop-blur">
        <span className="text-[11px] font-bold uppercase tracking-wide text-amber-800">
          DEBUG · varianta:
        </span>
        {labels.map((l, i) => (
          <button
            key={l}
            type="button"
            onClick={() => setActive(i)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              active === i
                ? "bg-brand-600 text-white shadow-sm"
                : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
            }`}
          >
            {l}
          </button>
        ))}
      </div>
      {items.map((node, i) => (
        <div key={i} className={active === i ? "" : "hidden"}>
          {node}
        </div>
      ))}
    </div>
  );
}
