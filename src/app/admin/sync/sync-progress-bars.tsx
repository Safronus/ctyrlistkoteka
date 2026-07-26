"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import type { SyncPhaseProgress, SyncProgress } from "@/lib/admin/syncProgress";

const nf = new Intl.NumberFormat("cs-CZ");

/** "2 s" / "3 min 20 s" / "1 h 4 min" — the log's eta_s, humanised. */
function formatEta(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rest = s % 60;
    return rest === 0 ? `${m} min` : `${m} min ${rest} s`;
  }
  const h = Math.floor(m / 60);
  const restMin = m % 60;
  return restMin === 0 ? `${h} h` : `${h} h ${restMin} min`;
}

function formatRate(rate: number): string {
  return rate >= 100
    ? `${nf.format(Math.round(rate))}/s`
    : `${rate.toFixed(1)}/s`;
}

/**
 * Progress bars for the running sync, derived from the log the panel already
 * streams (see lib/admin/syncProgress.ts). The terminal output stays — this
 * just answers "how far along is it" without reading log lines.
 */
export function SyncProgressBars({
  progress,
  running,
}: {
  progress: SyncProgress;
  running: boolean;
}) {
  const { maps, finds } = progress;
  // Nothing logged yet (run just started, or --only skipped both phases).
  if (!maps && !finds) return null;

  // The finds phase walks originals AND crops, so its total is files, not
  // finds. Spell that out rather than letting "41 888" read as find count.
  const filesNote =
    progress.findOriginals !== null && progress.findCrops !== null
      ? `${nf.format(progress.findOriginals)} originálů + ${nf.format(
          progress.findCrops,
        )} výřezů`
      : null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Průběh</h2>
        {running && (
          <Loader2
            className="h-3.5 w-3.5 animate-spin text-brand-600"
            aria-hidden
          />
        )}
      </header>
      <div className="space-y-3">
        {maps && (
          <Bar phase={maps} label="Lokační mapy" unit="map" idLabel="mapa" />
        )}
        {finds && (
          <Bar
            phase={finds}
            label="Nálezy"
            unit="souborů"
            note={filesNote ?? undefined}
            idLabel="nález"
          />
        )}
      </div>
    </section>
  );
}

function Bar({
  phase,
  label,
  unit,
  note,
  idLabel,
}: {
  phase: SyncPhaseProgress;
  label: string;
  unit: string;
  note?: string;
  /** Noun for the id range, e.g. "nález" → "právě nález #2969–#3349". */
  idLabel: string;
}) {
  const pct = Math.round(phase.fraction * 100);
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-900">
          {phase.finished && (
            <CheckCircle2
              className="h-3.5 w-3.5 text-emerald-600"
              aria-hidden
            />
          )}
          {label}
          {note && (
            <span className="font-normal text-gray-400">({note})</span>
          )}
        </span>
        <span className="font-mono text-xs tabular-nums text-gray-600">
          {nf.format(phase.done)} / {nf.format(phase.total)} {unit} ·{" "}
          <strong className="font-semibold">{pct} %</strong>
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-gray-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={phase.total}
        aria-valuenow={phase.done}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            phase.finished ? "bg-emerald-500" : "bg-brand-500"
          }`}
          style={{ width: `${Math.max(pct, phase.done > 0 ? 1 : 0)}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-gray-500">
        {phase.finished ? (
          "hotovo"
        ) : (
          <>
            {phase.idFrom !== null && phase.idTo !== null && (
              <>
                <span className="text-gray-700">
                  právě {idLabel}{" "}
                  <strong className="font-mono font-semibold">
                    {phase.idFrom === phase.idTo
                      ? `#${phase.idFrom}`
                      : `#${phase.idFrom}–#${phase.idTo}`}
                  </strong>
                </span>
                {" · "}
              </>
            )}
            zbývá {nf.format(phase.remaining)} {unit}
            {phase.etaSeconds !== null && ` · ~${formatEta(phase.etaSeconds)}`}
            {phase.ratePerSecond !== null &&
              phase.ratePerSecond > 0 &&
              ` · ${formatRate(phase.ratePerSecond)}`}
          </>
        )}
      </p>
    </div>
  );
}
