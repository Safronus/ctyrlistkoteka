"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, QrCode, Download, X } from "lucide-react";
import { getFindQr } from "./qr-action";

interface Props {
  findId: number;
}

/** Detail-page button: opens a modal with the styled QR SVG and
 *  download buttons (SVG + PNG). The SVG is generated server-side
 *  via `getFindQr`. The PNG conversion happens on the client through
 *  a canvas — no extra server-side rasteriser needed. */
export function FindQrButton({ findId }: Props) {
  const [open, setOpen] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pngBusy, setPngBusy] = useState(false);

  // Fetch once per open. Closing keeps the cached svg so reopening
  // is instant; only a refresh re-issues the server action.
  useEffect(() => {
    if (!open || svg) return;
    setError(null);
    startTransition(async () => {
      const r = await getFindQr(findId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSvg(r.svg);
    });
  }, [open, svg, findId, startTransition]);

  // Esc closes the modal. The backdrop <div> isn't focusable, so the key
  // is bound at the window level (same pattern as the screensaver).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const downloadSvg = () => {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    triggerDownload(blob, `ctyrlistek-${findId}.svg`);
  };

  const downloadPng = async () => {
    if (!svg || pngBusy) return;
    setPngBusy(true);
    setError(null);
    try {
      // Render the SVG into an offscreen canvas at 2× the SVG's
      // intrinsic size so the PNG print quality is generous. The
      // SVG includes width/height attributes so the Image() loads
      // at the natural size; we read those for the canvas dims.
      const blob = await svgToPngBlob(svg, 2);
      triggerDownload(blob, `ctyrlistek-${findId}.png`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PNG export selhal");
    } finally {
      setPngBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50"
      >
        <QrCode className="h-3.5 w-3.5" aria-hidden />
        QR kód
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`QR kód pro nález #${findId}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                QR kód · #{findId}
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

            {error && (
              <p className="mb-3 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                {error}
              </p>
            )}

            <div className="mb-3 flex min-h-[200px] items-center justify-center rounded border border-gray-200 bg-gray-50 p-2">
              {isPending || !svg ? (
                <Loader2
                  className="h-6 w-6 animate-spin text-gray-400"
                  aria-hidden
                />
              ) : (
                <div
                  className="w-full [&_svg]:h-auto [&_svg]:max-w-full"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={downloadSvg}
                disabled={!svg}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                SVG
              </button>
              <button
                type="button"
                onClick={downloadPng}
                disabled={!svg || pngBusy}
                className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-800 transition hover:border-brand-400 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pngBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Download className="h-3.5 w-3.5" aria-hidden />
                )}
                PNG
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke so the browser actually picks the URL up before
  // it disappears — Safari is the picky one here.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Rasterises an SVG string to a PNG Blob via an offscreen canvas.
 *  Multiplier scales up the canvas vs. the SVG's intrinsic size so
 *  the resulting PNG has plenty of pixels for print. */
function svgToPngBlob(svg: string, scale: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Pull width/height out of the SVG root so we know the canvas
    // size before loading the image. Regex is fine here — these
    // attributes are always literal integers in our generator.
    const wMatch = svg.match(/<svg[^>]*\swidth="(\d+)"/);
    const hMatch = svg.match(/<svg[^>]*\sheight="(\d+)"/);
    const baseW = wMatch ? Number(wMatch[1]) : 600;
    const baseH = hMatch ? Number(hMatch[1]) : 800;

    const url = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml" }),
    );
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = baseW * scale;
      canvas.height = baseH * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Canvas context není dostupný"));
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => {
        if (!b) {
          reject(new Error("PNG konverze selhala"));
          return;
        }
        resolve(b);
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("SVG se nepodařilo načíst do canvasu"));
    };
    img.src = url;
  });
}
