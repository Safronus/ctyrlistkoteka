/**
 * One tile of a "průměrné tempo" row — a rate and its unit.
 *
 * Shared because the all-time row and the per-year row are the same five
 * tiles and were the same component copied twice; a change to one had to
 * be remembered for the other.
 */
export function PaceCell({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  /**
   * Take both columns on a phone.
   *
   * The row is five tiles: `grid-cols-2` wraps them 2 + 2 + 1, and the
   * lone last one looked like a mistake. Widening it fills the row. Only
   * below `sm` — from there the row is five across and nothing wraps.
   */
  wide?: boolean;
}) {
  return (
    <li
      className={`rounded-md border border-gray-200 bg-gray-50 p-2 text-center ${
        wide ? "col-span-2 sm:col-span-1" : ""
      }`}
    >
      <p className="font-mono text-sm font-semibold tabular-nums text-gray-900">
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-gray-500">{label}</p>
    </li>
  );
}
