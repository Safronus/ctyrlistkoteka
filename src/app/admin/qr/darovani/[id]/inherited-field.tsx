"use client";

import { RotateCcw } from "lucide-react";
import { INPUT_CLS } from "../../qr-ui";

/**
 * A field that shows the campaign's text, ready to be edited over.
 *
 * The dialog used to leave these empty with a "dědí ze sady" placeholder,
 * which is honest about the storage but useless to work with: to tweak
 * one sentence of the wave's message for one card you first had to go
 * find that sentence and paste it back.
 *
 * So the value is filled in, and the DIFFERENCE is what gets marked. A
 * field matching the campaign is labelled "ze sady" and quietly stores
 * null, meaning a later edit of the wave's text still reaches this card.
 * The moment it differs it turns amber, says so, and offers the way back.
 *
 * Consequence worth knowing: typing the campaign's exact text into a
 * field does NOT pin it. That is deliberate — the alternative is silent
 * overrides that stop tracking the wave without anything on screen ever
 * looking different.
 */
export function InheritedField({
  label,
  hint,
  value,
  inherited,
  onChange,
  rows,
  mono,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  /** The campaign's value for this field; "" when it has none either. */
  inherited: string;
  onChange: (v: string) => void;
  /** Renders a textarea of this many rows instead of an input. */
  rows?: number;
  mono?: boolean;
  placeholder?: string;
}) {
  const overridden = value.trim() !== inherited.trim();
  const cls = `${INPUT_CLS}${mono ? " font-mono" : ""}${
    rows ? " resize-y" : ""
  }${overridden ? " border-amber-400 bg-amber-50/40" : ""}`;

  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-xs font-medium text-gray-700">
        {label}
        {overridden ? (
          <>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
              upraveno
            </span>
            <button
              type="button"
              onClick={() => onChange(inherited)}
              title="Vrátit text ze sady"
              className="inline-flex items-center gap-1 text-[11px] font-normal text-gray-500 underline-offset-2 transition hover:text-gray-800 hover:underline"
            >
              <RotateCcw className="h-3 w-3" aria-hidden />
              ze sady
            </button>
          </>
        ) : (
          <span className="text-[10px] font-normal uppercase tracking-wide text-gray-400">
            ze sady
          </span>
        )}
      </span>
      {rows ? (
        <textarea
          rows={rows}
          className={cls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          className={cls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
      {hint && (
        <span className="mt-1 block text-[11px] text-gray-400">{hint}</span>
      )}
    </label>
  );
}
