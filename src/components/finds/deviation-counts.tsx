"use client";

import { useTranslations } from "next-intl";

/**
 * "(N žlutě, M červeně)" — the amber (tone 1, off the location but on a map)
 * and rose (tone 2, off every map) deviated-find counts, colour-matched to
 * the map dots. Renders nothing when there are no deviated finds. Shared by
 * the /lokality list, the location detail page and the map's location sheet.
 */
export function DeviationCounts({
  amber,
  rose,
  className = "",
}: {
  amber: number;
  rose: number;
  className?: string;
}) {
  const t = useTranslations("Deviation");
  if (amber <= 0 && rose <= 0) return null;
  return (
    <span
      className={`whitespace-nowrap text-xs text-gray-500 ${className}`}
      title={t("title")}
    >
      {"("}
      <span className="font-medium text-amber-600">{amber}</span> {t("amber")}
      {", "}
      <span className="font-medium text-rose-600">{rose}</span> {t("rose")}
      {")"}
    </span>
  );
}
