"use client";

import { Lock } from "lucide-react";

/**
 * Form primitives shared by both QR generators on this page (page codes
 * and find codes). Extracted so the two forms stay visually identical
 * without either owning the other's markup.
 */

/**
 * The `disabled:` half is not decoration.
 *
 * A control inside a disabled `<fieldset>` gets no styling of its own from
 * the browser once a background is set explicitly — so the sheet-locked
 * fields were genuinely unusable while looking exactly like the editable
 * ones next to them. These three utilities are what makes "nejde měnit"
 * visible before the operator clicks and wonders why nothing types.
 */
const DISABLED_CLS =
  "disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-500";

export const SELECT_CLS =
  `w-full cursor-pointer rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 ${DISABLED_CLS}`;

export const INPUT_CLS =
  `w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 ${DISABLED_CLS}`;

/**
 * One height for every single-line control sitting in a row together.
 *
 * Inputs, selects and buttons each size themselves differently from
 * padding alone — a select adds room for its native arrow, a button sizes
 * to its text — so a row built out of all three never lines up unless the
 * height is stated. Deliberately NOT part of INPUT_CLS: textareas share
 * that constant and must stay free to grow.
 */
export const CONTROL_H = "h-9";
/** The compact variant, for filter strips in `text-xs`. */
export const CONTROL_H_SM = "h-7";

/** Height of a `Field` label (text-xs line box + mb-1). A bare button
 *  sharing a row with labelled fields needs exactly this much lead so its
 *  top edge meets theirs. */
export const LABEL_H = "mt-5";

/** A row of controls that must share a baseline: labels on top, hints
 *  hanging below without pushing anything out of line. */
export const ROW_CLS = "grid items-start gap-3";

/**
 * Marks a field the Google Sheet owns.
 *
 * A greyed-out input says "not now" but not why, and in a wave run from a
 * sheet HALF the panel is greyed and half isn't — so the badge is the only
 * thing that tells the two apart at a glance.
 */
export function SheetLockBadge() {
  return (
    <span
      title="Tohle pole je ve sdílené tabulce — uprav ho tam, jinak to příští synchronizace přepíše."
      className="ml-1.5 inline-flex items-center gap-1 rounded bg-sky-100 px-1.5 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-wide text-sky-900"
    >
      <Lock className="h-2.5 w-2.5" aria-hidden />
      z tabulky
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
  sheetLocked = false,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  /** Show the "z tabulky" badge next to the label. */
  sheetLocked?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-700">
        {label}
        {sheetLocked && <SheetLockBadge />}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-[11px] text-gray-400">{hint}</span>
      )}
    </label>
  );
}

export function Seg({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string; title?: string }[];
}) {
  return (
    <div className="inline-flex flex-wrap overflow-hidden rounded-md border border-gray-300">
      {options.map((o, i) => {
        const active = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            aria-pressed={active}
            title={o.title}
            className={`px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
              i > 0 ? "border-l border-gray-300" : ""
            } ${
              active
                ? "bg-brand-600 text-white"
                : "bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

export function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (b: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
      />
      {label}
    </label>
  );
}
