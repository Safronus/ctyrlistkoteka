"use client";

import { useEffect, useState } from "react";
import { Loader2, Download, X, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  renderFindQrChunkAction,
  ensureFindQrCodesAction,
} from "./find-qr-actions";
import type { FindQrInput } from "./qr-types";
import { triggerDownload, svgToPngBlob } from "./qr-download";
import { Check } from "./qr-ui";

/**
 * Export dialog for a batch of find QR codes.
 *
 * Everything is assembled in the BROWSER: the server returns SVG strings
 * and PNG/PDF come from a canvas here. That is a hard requirement, not a
 * preference — the title carries a 🍀 and the VPS has no colour-emoji
 * font, so a server-side rasteriser would print a missing-glyph box on
 * exactly the batch that goes onto cards.
 *
 * Downloading also enrols anything not yet listed, so numbers typed by
 * hand show up in the evidence afterwards (idempotent by primary key —
 * re-downloading the same batch can't duplicate a row).
 *
 * There is no hard batch cap by request; instead a big batch is
 * confirmed, and progress is reported per chunk so a long run is visibly
 * alive rather than a frozen button.
 */

/** Ids per server round-trip. Matches RENDER_CHUNK_MAX in find-qr-actions. */
const CHUNK = 100;

/** Above this the batch is worth a confirmation before it runs. */
const BIG_BATCH = 500;

/** Print resolution for rasterised output. */
const PRINT_DPI = 300;

type Fmt = "svg" | "png" | "pdf";

export function FindQrExportDialog({
  ids,
  cfg,
  sizeCm,
  onClose,
}: {
  ids: number[];
  cfg: FindQrInput;
  sizeCm: number;
  onClose: () => void;
}) {
  const [fmts, setFmts] = useState<Record<Fmt, boolean>>({
    svg: true,
    png: true,
    pdf: false,
  });
  const [cutGuides, setCutGuides] = useState(true);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmedBig, setConfirmedBig] = useState(false);
  const router = useRouter();

  // Esc closes — same pattern as the per-find QR modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !running) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  const anyFmt = fmts.svg || fmts.png || fmts.pdf;
  const needsConfirm = ids.length > BIG_BATCH && !confirmedBig;

  const run = async () => {
    setError(null);
    setRunning(true);
    setDone(0);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      // The PNG pixel width for the chosen physical size; the SVG's own
      // width is its intrinsic px, so the scale is derived per item.
      const targetPx = Math.round((sizeCm / 2.54) * PRINT_DPI);
      const forPdf: { findId: number; svg: string }[] = [];

      setPhase("Přidávám do seznamu…");
      const enrol = await ensureFindQrCodesAction(ids);
      if (!enrol.ok) throw new Error(enrol.error);

      setPhase("Generuji kódy…");
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const r = await renderFindQrChunkAction(slice, cfg);
        if (!r.ok) throw new Error(r.error);
        for (const item of r.items) {
          const base = `ctyrlistek-${item.findId}`;
          if (fmts.svg) {
            zip.file(`${base}.svg`, withPhysicalSize(item.svg, sizeCm));
          }
          if (fmts.png) {
            const scale = targetPx / intrinsicWidth(item.svg);
            zip.file(`${base}.png`, await svgToPngBlob(item.svg, scale));
          }
          if (fmts.pdf) forPdf.push(item);
        }
        setDone(Math.min(i + slice.length, ids.length));
      }

      if (fmts.pdf && forPdf.length > 0) {
        setPhase("Skládám tiskový arch…");
        const pdfBlob = await buildSheetPdf(forPdf, sizeCm * 10, cutGuides);
        zip.file("tiskovy-arch.pdf", pdfBlob);
      }

      setPhase("Balím ZIP…");
      const blob = await zip.generateAsync({ type: "blob" });
      const stamp = new Date().toISOString().slice(0, 10);
      triggerDownload(blob, `ctyrlistkoteka-qr-nalezy-${stamp}.zip`);
      router.refresh(); // newly enrolled finds appear in the list
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export selhal");
      setRunning(false);
      setPhase(null);
    }
  };

  const estMb = estimateMb(ids.length, fmts, sizeCm);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Stáhnout balíček
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              {ids.length.toLocaleString("cs-CZ")}{" "}
              {ids.length === 1
                ? "nález"
                : ids.length < 5
                  ? "nálezy"
                  : "nálezů"}{" "}
              · {sizeCm.toFixed(1).replace(".", ",")} cm
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            aria-label="Zavřít"
            className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="space-y-2">
          <Check
            checked={fmts.svg}
            onChange={(b) => setFmts((f) => ({ ...f, svg: b }))}
            label="SVG — vektor, tisknutelný v libovolné velikosti"
          />
          <Check
            checked={fmts.png}
            onChange={(b) => setFmts((f) => ({ ...f, png: b }))}
            label={`PNG — ${PRINT_DPI} DPI pro zvolených ${sizeCm.toFixed(1).replace(".", ",")} cm`}
          />
          <Check
            checked={fmts.pdf}
            onChange={(b) => setFmts((f) => ({ ...f, pdf: b }))}
            label="PDF — jeden tiskový arch A4 s mřížkou kódů"
          />
          {fmts.pdf && (
            <div className="pl-6">
              <Check
                checked={cutGuides}
                onChange={setCutGuides}
                label="Řezací linky kolem každého kódu"
              />
            </div>
          )}
        </div>

        {!running && anyFmt && (
          <p className="text-xs text-gray-500">
            Odhad velikosti ZIPu: ~{estMb} MB. Vše se skládá v prohlížeči, okno
            nechej otevřené.
          </p>
        )}

        {needsConfirm && (
          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-start gap-2 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Velká dávka ({ids.length.toLocaleString("cs-CZ")} nálezů).
                Generování poběží řádově {estimateMinutes(ids.length, fmts)} a
                prohlížeč si během něj podrží celý balíček v paměti.
              </span>
            </p>
            <button
              type="button"
              onClick={() => setConfirmedBig(true)}
              className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-100"
            >
              Rozumím, pokračovat
            </button>
          </div>
        )}

        {error && (
          <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
            {error}
          </p>
        )}

        {running ? (
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{
                  width: `${ids.length ? (done / ids.length) * 100 : 0}%`,
                }}
              />
            </div>
            <p className="flex items-center gap-2 text-xs text-gray-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {phase} {done.toLocaleString("cs-CZ")} /{" "}
              {ids.length.toLocaleString("cs-CZ")}
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={run}
            disabled={!anyFmt || needsConfirm || ids.length === 0}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800 transition hover:border-brand-400 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            Vygenerovat a stáhnout ZIP
          </button>
        )}
      </div>
    </div>
  );
}

/** Intrinsic px width the renderer gave the SVG. */
function intrinsicWidth(svg: string): number {
  return Number(/<svg[^>]*\swidth="(\d+)"/.exec(svg)?.[1] ?? 600);
}

/** Restates the SVG's size in millimetres while keeping the viewBox, so
 *  dropping the file into a layout program lands it at exactly the size
 *  the operator previewed instead of at an arbitrary pixel scale. */
function withPhysicalSize(svg: string, widthCm: number): string {
  const w = intrinsicWidth(svg);
  const h = Number(/<svg[^>]*\sheight="(\d+)"/.exec(svg)?.[1] ?? w);
  const wMm = (widthCm * 10).toFixed(2);
  const hMm = ((widthCm * 10 * h) / w).toFixed(2);
  return svg
    .replace(/(<svg[^>]*\s)width="\d+"/, `$1width="${wMm}mm"`)
    .replace(/(<svg[^>]*\s)height="\d+"/, `$1height="${hMm}mm"`);
}

/** A4 sheet tiling every code in the batch, one image per cell with its
 *  find number beneath. Reuses the same canvas rasteriser as the PNGs. */
async function buildSheetPdf(
  items: { findId: number; svg: string }[],
  pieceMm: number,
  cutGuides: boolean,
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  const first = items[0]!;
  const baseW = intrinsicWidth(first.svg);
  const baseH = Number(
    /<svg[^>]*\sheight="(\d+)"/.exec(first.svg)?.[1] ?? baseW,
  );
  const pieceH = pieceMm * (baseH / baseW);

  const margin = 8;
  const gap = cutGuides ? 3 : 2;
  const cols = Math.max(
    1,
    Math.floor((210 - 2 * margin + gap) / (pieceMm + gap)),
  );
  const rows = Math.max(
    1,
    Math.floor((297 - 2 * margin + gap) / (pieceH + gap)),
  );
  const perPage = cols * rows;

  const scale = Math.max(1, ((pieceMm / 25.4) * PRINT_DPI) / baseW);

  for (let i = 0; i < items.length; i++) {
    if (i > 0 && i % perPage === 0) pdf.addPage();
    const onPage = i % perPage;
    const x = margin + (onPage % cols) * (pieceMm + gap);
    const y = margin + Math.floor(onPage / cols) * (pieceH + gap);
    const dataUrl = await blobToDataUrl(
      await svgToPngBlob(items[i]!.svg, scale),
    );
    pdf.addImage(dataUrl, "PNG", x, y, pieceMm, pieceH);
    if (cutGuides) {
      pdf.setDrawColor(180);
      pdf.setLineWidth(0.15);
      pdf.rect(x - gap / 2, y - gap / 2, pieceMm + gap, pieceH + gap);
    }
  }
  return pdf.output("blob");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Načtení obrázku selhalo"));
    r.readAsDataURL(blob);
  });
}

/** Rough ZIP size, deliberately generous — it exists to stop someone
 *  starting a 2 GB download by accident, not to be exact. */
function estimateMb(
  count: number,
  fmts: Record<Fmt, boolean>,
  sizeCm: number,
): string {
  const px = (sizeCm / 2.54) * PRINT_DPI;
  let perItemKb = 0;
  if (fmts.svg) perItemKb += 60; // ~1 <use> per module, gzipped in the zip
  if (fmts.png) perItemKb += (px * px) / 12000; // flat-colour PNG
  if (fmts.pdf) perItemKb += (px * px) / 12000;
  const mb = (count * perItemKb) / 1024;
  return mb < 10 ? mb.toFixed(1).replace(".", ",") : String(Math.round(mb));
}

/** Wall-clock guess for the warning line. Rasterising dominates. */
function estimateMinutes(count: number, fmts: Record<Fmt, boolean>): string {
  const perItemMs = 20 + (fmts.png ? 40 : 0) + (fmts.pdf ? 40 : 0);
  const min = (count * perItemMs) / 60000;
  if (min < 1) return "pod minutu";
  if (min < 2) return "minutu";
  return `${Math.round(min)} minut`;
}
