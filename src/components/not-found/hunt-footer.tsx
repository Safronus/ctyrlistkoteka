"use client";

import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { NotFoundActions } from "./not-found-actions";

/** Status line, round counter and the ways on — shared by both 404 games. */
export function HuntFooter({
  round,
  tries,
  total,
  found,
  message,
  onNext,
}: {
  round: number;
  tries: number;
  total: number;
  found: boolean;
  message: string;
  onNext: () => void;
}) {
  const t = useTranslations("NotFound");
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-gray-500">
        <span className="rounded-full bg-brand-100 px-2 py-0.5 font-semibold text-brand-800">
          {t("round", { n: round })}
        </span>
        {tries > 0 && !found && <span className="font-mono">{t("tries", { count: tries })}</span>}
        {total > 0 && <span>{t("totalFound", { count: total })}</span>}
      </p>
      <p role="status" aria-live="polite" className="min-h-5 max-w-xl text-center text-sm text-gray-700">
        {message}
      </p>
      {found && (
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center gap-2 rounded-md border border-brand-300 bg-white px-4 py-2 text-sm font-semibold text-brand-800 shadow-sm transition hover:bg-brand-50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          {t("nextRound", { n: round + 1 })}
        </button>
      )}
      <NotFoundActions showRandom={found} />
    </div>
  );
}
