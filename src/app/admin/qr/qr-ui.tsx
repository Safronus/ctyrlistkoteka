"use client";

/**
 * Form primitives shared by both QR generators on this page (page codes
 * and find codes). Extracted so the two forms stay visually identical
 * without either owning the other's markup.
 */

export const SELECT_CLS =
  "w-full cursor-pointer rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";

export const INPUT_CLS =
  "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-700">
        {label}
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
            className={`px-2.5 py-1.5 text-xs font-medium transition ${
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
