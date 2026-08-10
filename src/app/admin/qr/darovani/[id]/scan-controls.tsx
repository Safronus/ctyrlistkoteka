"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pause, Play, RotateCcw } from "lucide-react";
import {
  resetCampaignScansAction,
  setScansPausedAction,
} from "../../drop-actions";
import { CONTROL_H_SM } from "../../qr-ui";

/**
 * The two switches that decide whether a wave's scan counters mean
 * anything: pause counting, and zero it.
 *
 * They belong together because they are used together — pause while the
 * cards are still on the kitchen table, test them, zero what the testing
 * recorded, then unpause on the way out the door.
 */
export function ScanControls({
  campaignId,
  paused,
  totalScans,
}: {
  campaignId: number;
  paused: boolean;
  /** Only to decide whether resetting would do anything. */
  totalScans: number;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const togglePause = () => {
    setError(null);
    start(async () => {
      const r = await setScansPausedAction(campaignId, !paused);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  };

  const reset = () => {
    setError(null);
    start(async () => {
      const r = await resetCampaignScansAction(campaignId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setConfirm(false);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
      {error && <span className="text-red-700">{error}</span>}

      <button
        type="button"
        onClick={togglePause}
        disabled={busy}
        title={
          paused
            ? "Znovu počítat naskenování — zapni, až kartičky opravdu půjdou ven"
            : "Přestat počítat naskenování. Stránka po naskenování funguje dál, jen se nic nezapíše a nic se nepřepne na „nalezeno“."
        }
        className={`${CONTROL_H_SM} inline-flex items-center gap-1.5 rounded-md border px-2.5 font-medium transition disabled:opacity-50 ${
          paused
            ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
            : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
        }`}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : paused ? (
          <Play className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Pause className="h-3.5 w-3.5" aria-hidden />
        )}
        {paused ? "Spustit počítání" : "Pozastavit počítání"}
      </button>

      {/* Two-step, like every other undoable-by-nobody button here: this
          throws away the whole wave's scan history. */}
      {confirm ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-gray-600">Opravdu vynulovat celou sadu?</span>
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className={`${CONTROL_H_SM} inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-2.5 font-medium text-red-800 transition hover:bg-red-100 disabled:opacity-50`}
          >
            {busy && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            )}
            Ano, vynulovat
          </button>
          <button
            type="button"
            onClick={() => setConfirm(false)}
            className={`${CONTROL_H_SM} rounded-md border border-gray-300 bg-white px-2.5 font-medium text-gray-700 transition hover:bg-gray-50`}
          >
            Zpět
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          disabled={busy || totalScans === 0}
          title={
            totalScans === 0
              ? "Zatím není co nulovat"
              : "Smaže všechna naskenování celé sady a vrátí „nalezené“ kusy zpět na „schované“"
          }
          className={`${CONTROL_H_SM} inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50`}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Vynulovat počty
        </button>
      )}
    </div>
  );
}
