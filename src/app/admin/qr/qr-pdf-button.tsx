"use client";

import { useState } from "react";
import { FileDown, Loader2, X } from "lucide-react";
import { getQrSvgAction } from "./qr-actions";
import { generateQrPdf } from "./qr-pdf";

const PIECE_OPTS = [
  { mm: 25, l: "25 mm" },
  { mm: 40, l: "40 mm" },
  { mm: 60, l: "60 mm" },
];

export function QrPdfButton({ id }: { id: number }) {
  const [open, setOpen] = useState(false);
  const [pieceMm, setPieceMm] = useState(40);
  const [fill, setFill] = useState(true);
  const [count, setCount] = useState(12);
  const [cutGuides, setCutGuides] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onGenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await getQrSvgAction(id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      await generateQrPdf(r.svg, `ctyrlistkoteka-qr-${r.token}-tisk.pdf`, {
        pieceMm,
        count: fill ? "fill" : Math.max(1, Math.min(500, count)),
        cutGuides,
      });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF se nepodařilo vytvořit");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Export do PDF (tisk)"
        aria-label="Export do PDF"
        className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1.5 text-gray-700 transition hover:bg-gray-50"
      >
        <FileDown className="h-3.5 w-3.5" aria-hidden />
        <span className="ml-1 text-[11px]">PDF</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Export QR do PDF"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                PDF k tisku
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Zavřít"
                className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <span className="mb-1 block text-xs font-medium text-gray-700">
                  Velikost kusu
                </span>
                <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
                  {PIECE_OPTS.map((o, i) => (
                    <button
                      key={o.mm}
                      type="button"
                      onClick={() => setPieceMm(o.mm)}
                      className={`px-3 py-1.5 text-xs font-medium transition ${
                        i > 0 ? "border-l border-gray-300" : ""
                      } ${
                        pieceMm === o.mm
                          ? "bg-brand-600 text-white"
                          : "bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="mb-1 block text-xs font-medium text-gray-700">
                  Počet kusů
                </span>
                <label className="flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="radio"
                    checked={fill}
                    onChange={() => setFill(true)}
                    className="text-brand-600"
                  />
                  Zaplnit A4 (kolik se vejde)
                </label>
                <label className="mt-1 flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="radio"
                    checked={!fill}
                    onChange={() => setFill(false)}
                    className="text-brand-600"
                  />
                  Přesný počet:
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                    onFocus={() => setFill(false)}
                    className="w-20 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                </label>
                <p className="mt-1 text-[11px] text-gray-400">
                  Víc kusů než se vejde na stranu = více stránek.
                </p>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={cutGuides}
                  onChange={(e) => setCutGuides(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
                />
                Řezací linky (kam stříhat)
              </label>

              {error && (
                <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                  {error}
                </p>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onGenerate}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800 transition hover:border-brand-400 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <FileDown className="h-4 w-4" aria-hidden />
                  )}
                  Stáhnout PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
