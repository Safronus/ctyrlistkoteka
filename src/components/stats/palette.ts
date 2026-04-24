/** Shared color palette for all charts. Keeps the stats page visually cohesive. */
export const BRAND = "#4d9748";
export const BRAND_DARK = "#2f6230";
export const BRAND_LIGHT = "#a1cf9a";
export const ANON = "#a855f7";

/** Rotating palette for categorical charts (pie slices, bar groups). */
export const CATEGORY_COLORS = [
  "#4d9748",
  "#2f6230",
  "#a1cf9a",
  "#c7e7c3",
  "#f59e0b",
  "#a855f7",
  "#0ea5e9",
  "#ef4444",
  "#64748b",
  "#eab308",
] as const;

export function colorFor(index: number): string {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length] ?? BRAND;
}
