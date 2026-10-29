"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { RefreshCw, Timer, Trophy } from "lucide-react";
import { NotFoundActions } from "./not-found-actions";
import {
  difficultyTier,
  formatDuration,
  MAX_ROUND,
  summarizeTimes,
  tableRow,
  tableRowLabel,
  todayByRow,
  type HuntGame,
  type PersonalBests,
  type Tier,
} from "./hunt";

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

const TIER_COLOR: Record<Tier, string> = {
  easy: "bg-emerald-400",
  medium: "bg-lime-500",
  hard: "bg-amber-500",
  master: "bg-rose-500",
};

/** Outcome of the round just won, against the stored personal best. */
export type RoundRecord = { improved: boolean; previous: number | null } | null;

/**
 * Round counter, difficulty meter, clock, result, speed table and the ways
 * on — shared by both 404 games. Visit stats are React state; personal
 * bests come from usePersonalBests (this browser only). The running clock
 * stays out of the live region so a screen reader isn't flooded; the round
 * result (with its time) is announced instead.
 */
export function HuntFooter({
  game,
  round,
  tries,
  total,
  found,
  startedAt,
  times,
  bests,
  record,
  message,
  onNext,
}: {
  game: HuntGame;
  round: number;
  tries: number;
  total: number;
  found: boolean;
  startedAt: number;
  /** This visit's round times, in round order (times[i] = round i + 1). */
  times: number[];
  bests: PersonalBests;
  record: RoundRecord;
  message: string;
  onNext: () => void;
}) {
  const t = useTranslations("NotFound");
  const locale = useLocale();
  const now = useTicker(!found);
  const stats = summarizeTimes(times);
  const elapsed = found && stats.last !== null ? stats.last : Math.max(0, now - startedAt);
  const fmt = (ms: number) => formatDuration(ms, locale);
  const tier = difficultyTier(round);
  // Rounds past MAX_ROUND keep its difficulty and share its row („8+“).
  const shownRound = tableRow(round);
  const shownLabel = tableRowLabel(shownRound);
  const today = todayByRow(times);
  const tableRounds = Array.from({ length: MAX_ROUND }, (_, i) => i + 1).filter(
    (r) => r <= shownRound || bests[game][r] !== undefined,
  );

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-gray-600">
        <span className="rounded-full bg-brand-100 px-2 py-0.5 font-semibold text-brand-800">
          {t("round", { n: round })}
        </span>
        <span className="inline-flex items-center gap-2">
          <span>
            {t("difficulty")}: <strong className="text-gray-800">{t(`tier.${tier}`)}</strong>
          </span>
          <span className="flex gap-0.5" aria-hidden>
            {Array.from({ length: MAX_ROUND }, (_, i) => (
              <span
                key={i}
                className={`h-2.5 w-2 rounded-sm ${i < shownRound ? TIER_COLOR[difficultyTier(i + 1)] : "bg-gray-200"}`}
              />
            ))}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 font-mono text-sm text-gray-800" aria-hidden>
          <Timer className="h-3.5 w-3.5" />
          {fmt(elapsed)}
        </span>
        {tries > 0 && !found && <span className="font-mono">{t("tries", { count: tries })}</span>}
        {total > 0 && <span>{t("totalFound", { count: total })}</span>}
      </div>

      <p role="status" aria-live="polite" className="min-h-5 max-w-xl text-center text-sm text-gray-700">
        {message}
        {found && stats.last !== null && ` ${t("roundTime", { time: fmt(stats.last) })}`}
      </p>

      {found && record?.improved && (
        <p className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900 motion-safe:animate-[ctyr-pop_0.6s]">
          <Trophy className="h-4 w-4" aria-hidden />
          {record.previous === null
            ? t("firstRecord", { n: shownLabel })
            : t("personalRecord", { n: shownLabel, previous: fmt(record.previous) })}
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

      <details className="w-full max-w-md rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-gray-800">{t("speedTable")}</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-gray-500">
            <tr>
              <th className="py-1 font-medium">{t("colRound")}</th>
              <th className="py-1 font-medium">{t("colTier")}</th>
              <th className="py-1 text-right font-medium">{t("colBest")}</th>
              <th className="py-1 text-right font-medium">{t("colToday")}</th>
            </tr>
          </thead>
          <tbody>
            {tableRounds.map((r) => {
              const best = bests[game][r];
              const todayRow = today.get(r);
              return (
                <tr key={r} className={r === shownRound ? "bg-brand-50 font-semibold" : ""}>
                  <td className="py-1">{tableRowLabel(r)}</td>
                  <td className="py-1">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${TIER_COLOR[difficultyTier(r)]}`} aria-hidden />
                      {t(`tier.${difficultyTier(r)}`)}
                    </span>
                  </td>
                  <td className="py-1 text-right font-mono">{best !== undefined ? fmt(best) : "—"}</td>
                  <td className="py-1 text-right font-mono">
                    {todayRow ? fmt(todayRow.best) : "—"}
                    {todayRow && todayRow.count > 1 && (
                      <span className="ml-1 font-sans text-gray-500">{t("roundsCount", { count: todayRow.count })}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-gray-500">
          {t("storedNote", { game: t(`gameName.${game}`) })}
        </p>
      </details>

      <NotFoundActions showRandom={found} />
      <style>{`@keyframes ctyr-pop { 0% { transform: scale(1) } 50% { transform: scale(1.35) rotate(12deg) } 100% { transform: scale(1) } }`}</style>
    </div>
  );
}
