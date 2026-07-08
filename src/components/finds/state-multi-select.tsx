"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown } from "lucide-react";
import type { FindState } from "@prisma/client";

/**
 * Multi-select for the /sbirka "Stav" filter. Native <select multiple> is
 * miserable to use, so this is a checkbox dropdown that still reads like the
 * neighbouring native selects (same chip styling, same faceted counts,
 * same zero-hiding).
 *
 * Semantics are AND: picking several states narrows to finds that carry
 * ALL of them. The `counts` here are co-occurrence counts (finds matching
 * the rest of the filter PLUS the current state selection PLUS the option),
 * so unticked states that can't co-exist with the selection drop out.
 */
export function StateMultiSelect({
  available,
  selected,
  counts,
  formatCount,
  onChange,
  selectCls,
  allLabel,
}: {
  available: readonly FindState[];
  selected: readonly FindState[];
  counts: Partial<Record<FindState, number>>;
  formatCount: (n: number) => string;
  onChange: (next: FindState[]) => void;
  selectCls: string;
  allLabel: string;
}) {
  const tStates = useTranslations("States");
  const tFilter = useTranslations("FilterBar");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedSet = new Set(selected);
  // Keep a state visible when it has a co-occurrence count, or is already
  // ticked (so the user can always untick it even if the combination is
  // otherwise empty).
  const visible = available.filter(
    (s) => (counts[s] ?? 0) > 0 || selectedSet.has(s),
  );

  const toggle = (s: FindState) => {
    onChange(
      selectedSet.has(s)
        ? selected.filter((x) => x !== s)
        : [...selected, s],
    );
  };

  const optionText = (s: FindState) => {
    const c = counts[s];
    return c == null ? tStates(s) : `${tStates(s)} (${formatCount(c)})`;
  };

  const buttonLabel =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? tStates(selected[0]!)
        : tFilter("statesSelected", { count: selected.length });

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${selectCls} flex w-full items-center text-left`}
      >
        <span
          className={`truncate ${selected.length === 0 ? "text-gray-500" : ""}`}
        >
          {buttonLabel}
        </span>
      </button>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
        aria-hidden
      />
      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-gray-200 bg-white p-1 shadow-xl"
        >
          {visible.map((s) => {
            const on = selectedSet.has(s);
            return (
              <button
                key={s}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(s)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                  on
                    ? "bg-brand-50 text-brand-800"
                    : "text-gray-800 hover:bg-gray-100"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    on
                      ? "border-brand-600 bg-brand-600 text-white"
                      : "border-gray-300 bg-white"
                  }`}
                >
                  {on && <Check className="h-3 w-3" aria-hidden />}
                </span>
                <span className="truncate">{optionText(s)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
