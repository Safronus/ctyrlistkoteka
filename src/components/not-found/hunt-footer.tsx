"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { RefreshCw, Timer, Trophy } from "lucide-react";
import { NotFoundActions } from "./not-found-actions";
import { formatDuration, summarizeTimes } from "./hunt";

/** `performance.now()`, refreshed every 100 ms while `active`. */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/**
 * Status line, round counter, clock and speed stats, and the ways on —
 * shared by both 404 games. Stats live for this visit only (React state):
 * the project keeps browser storage for UI preferences, not game state.
 * The running clock stays out of the live region so a screen reader isn't
 * flooded; the round result (with its time) is announced instead.
 */
export function HuntFooter({
  round,
  tries,
  total,
  found,
  startedAt,
  times,
  message,
  onNext,
}: {
  round: number;
  tries: number;
  total: number;
  found: boolean;
  startedAt: number;
  times: number[];
  message: string;
  onNext: () => void;
}) {
  const t = useTranslations("NotFound");
  const locale = useLocale();
  const now = useTicker(!found);
  const stats = summarizeTimes(times);
  const elapsed = found && stats.last !== null ? stats.last : Math.max(0, now - startedAt);
  const fmt = (ms: number) => formatDuration(ms, locale);

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-gray-500">
        <span className="rounded-full bg-brand-100 px-2 py-0.5 font-semibold text-brand-800">
          {t("round", { n: round })}
        </span>
        <span className="inline-flex items-center gap-1 font-mono text-sm text-gray-800" aria-hidden>
          <Timer className="h-3.5 w-3.5" />
          {fmt(elapsed)}
        </span>
        {tries > 0 && !found && <span className="font-mono">{t("tries", { count: tries })}</span>}
        {total > 0 && <span>{t("totalFound", { count: total })}</span>}
      </p>
      <p role="status" aria-live="polite" className="min-h-5 max-w-xl text-center text-sm text-gray-700">
        {message}
        {found && stats.last !== null && ` ${t("roundTime", { time: fmt(stats.last) })}`}
      </p>
      {found && stats.newRecord && (
        <p className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900 motion-safe:animate-[ctyr-pop_0.6s]">
          <Trophy className="h-4 w-4" aria-hidden />
          {t("newRecord")}
        </p>
      )}
      {stats.best !== null && stats.average !== null && times.length > 1 && (
        <p className="text-xs text-gray-600">
          {t("bestAverage", { best: fmt(stats.best), average: fmt(stats.average) })}
        </p>
      )}
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
      <style>{`@keyframes ctyr-pop { 0% { transform: scale(1) } 50% { transform: scale(1.35) rotate(12deg) } 100% { transform: scale(1) } }`}</style>
    </div>
  );
}
