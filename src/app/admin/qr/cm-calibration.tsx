"use client";

import { useState, useTransition } from "react";
import { CreditCard, Check, RotateCcw, Loader2 } from "lucide-react";
import {
  saveQrCalibrationAction,
  resetQrCalibrationAction,
} from "./find-qr-actions";

/**
 * Screen calibration for the physical-size preview.
 *
 * CSS defines 1 cm as 37.8 px, but a real monitor runs anywhere from ~80
 * to ~220 physical pixels per inch — so a "1 cm" box on screen can be
 * 20 % off. That matters here and nowhere else on the site: judging
 * whether a QR is still scannable is a millimetre-scale question about
 * module size, and a preview that lies by 20 % answers it wrongly.
 *
 * The operator drags a rectangle to match a payment card (85.6 mm wide,
 * ISO/IEC 7810 ID-1 — the one physical ruler everyone has in a pocket),
 * and we store the resulting px-per-cm server-side.
 */

const CARD_WIDTH_CM = 8.56;

export function CmCalibration({
  pxPerCm,
  calibrated,
}: {
  pxPerCm: number;
  calibrated: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(pxPerCm * CARD_WIDTH_CM);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const r = await saveQrCalibrationAction(width / CARD_WIDTH_CM);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
    });
  };

  const reset = () => {
    setError(null);
    startTransition(async () => {
      const r = await resetQrCalibrationAction();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setWidth(pxPerCm * CARD_WIDTH_CM);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 underline-offset-2 transition hover:text-gray-700 hover:underline"
      >
        <CreditCard className="h-3.5 w-3.5" aria-hidden />
        {calibrated
          ? `Obrazovka zkalibrovaná (${pxPerCm.toFixed(1).replace(".", ",")} px/cm) — přenastavit`
          : "Náhled je orientační — zkalibrovat obrazovku"}
      </button>
    );
  }

  // Rendered as an overlay rather than inline: at a high-DPI screen's
  // ~100 px/cm the reference rectangle is over 850 px wide, which would
  // never fit the preview column it is triggered from — and a clipped
  // rectangle can't be matched against a real card.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl space-y-3 overflow-x-auto rounded-xl border border-brand-200 bg-white p-5 shadow-xl">
        <p className="text-xs text-gray-700">
          Přilož k obrazovce platební kartu (nebo občanku — mají stejný rozměr)
          a posuvníkem srovnej obdélník přesně na její šířku.
        </p>
        <div
          className="h-16 rounded-md border-2 border-dashed border-brand-500 bg-brand-50"
          style={{ width: `${width}px` }}
          aria-hidden
        />
        <input
          type="range"
          min={Math.round(15 * CARD_WIDTH_CM)}
          max={Math.round(120 * CARD_WIDTH_CM)}
          step={1}
          value={Math.round(width)}
          onChange={(e) => setWidth(Number(e.target.value))}
          className="w-full accent-brand-600"
          aria-label="Šířka obdélníku odpovídající platební kartě"
        />
        <p className="text-[11px] text-gray-500">
          Šířka karty je 8,56 cm →{" "}
          {(width / CARD_WIDTH_CM).toFixed(1).replace(".", ",")} px/cm.
        </p>
        {error && (
          <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-white px-2.5 py-1 text-xs font-medium text-brand-800 transition hover:bg-brand-100 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Check className="h-3.5 w-3.5" aria-hidden />
            )}
            Uložit
          </button>
          {calibrated && (
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Zrušit kalibraci
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto text-xs text-gray-500 underline-offset-2 hover:underline"
          >
            Zavřít
          </button>
        </div>
      </div>
    </div>
  );
}

/** Centimetre ruler drawn at the calibrated scale — a standing check that
 *  the calibration still holds (e.g. after plugging in another monitor). */
export function CmRuler({ pxPerCm, cm }: { pxPerCm: number; cm: number }) {
  const ticks = Math.max(1, Math.ceil(cm));
  return (
    <div className="select-none" aria-hidden>
      <div
        className="relative h-4 border-b border-gray-300"
        style={{ width: `${ticks * pxPerCm}px`, maxWidth: "100%" }}
      >
        {Array.from({ length: ticks + 1 }, (_, i) => (
          <span
            key={i}
            className="absolute bottom-0 w-px bg-gray-400"
            style={{ left: `${i * pxPerCm}px`, height: i % 5 === 0 ? 12 : 7 }}
          />
        ))}
      </div>
      <p className="mt-0.5 text-[10px] text-gray-400">{ticks} cm</p>
    </div>
  );
}
