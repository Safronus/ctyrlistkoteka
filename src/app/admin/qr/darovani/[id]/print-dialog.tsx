"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2, Printer, X } from "lucide-react";
import { renderDropQrBatchAction } from "../../drop-actions";
import { svgToPngBlob, triggerDownload } from "../../qr-download";
import { Seg } from "../../qr-ui";

/**
 * The print sheet: a wave of cards laid out on A4, ready to cut.
 *
 * Assembled entirely in the BROWSER, like every other QR export here, and
 * for the same hard reason: card titles carry a 🍀 and the VPS has no
 * colour-emoji font, so a server-side rasteriser would print a
 * missing-glyph box on exactly the batch destined for scissors.
 *
 * Cards are packed row by row rather than into a fixed grid, because a
 * card may override the wave's print size — a row is as tall as its
 * tallest card and wraps when the next one no longer fits. With one size
 * throughout (the normal case) that degenerates into a plain grid.
 */

/** Ids per server round-trip — matches the cap in renderDropQrBatchAction. */
const CHUNK = 40;

/** Raster resolution for the images placed into the PDF. */
const PRINT_DPI = 300;

/** Above this the sheet is worth a word of warning about size and time. */
const BIG_BATCH = 40;

const A4_W_MM = 210;
const A4_H_MM = 297;
/** Printers cannot reach the paper edge; keep the cards inside this. */
const PAGE_MARGIN_MM = 8;

export type CutStyle = "corners" | "box" | "none";

const CUT_OPTS = [
  { v: "corners", l: "Rohové značky", title: "Krátké čárky v rozích, mimo kartičku" },
  { v: "box", l: "Rámeček", title: "Souvislá linka kolem kartičky" },
  { v: "none", l: "Žádné", title: "Jen kartičky, bez vodítek" },
];

interface Rendered {
  id: number;
  findId: number;
  svg: string;
  sizeCm: number;
}

export function DropPrintDialog({
  itemIds,
  campaignName,
  onClose,
}: {
  itemIds: number[];
  campaignName: string;
  onClose: () => void;
}) {
  const [gapMm, setGapMm] = useState(4);
  const [cut, setCut] = useState<CutStyle>("corners");
  const [numbers, setNumbers] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !running) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  const run = async () => {
    setError(null);
    setRunning(true);
    setDone(0);
    try {
      setPhase("Generuji kódy…");
      const cards: Rendered[] = [];
      for (let i = 0; i < itemIds.length; i += CHUNK) {
        const r = await renderDropQrBatchAction(itemIds.slice(i, i + CHUNK));
        if (!r.ok) throw new Error(r.error);
        cards.push(...r.items);
        setDone(Math.min(i + CHUNK, itemIds.length));
      }
      if (cards.length === 0) throw new Error("Není co tisknout");

      setPhase("Skládám arch…");
      const blob = await buildSheet(cards, { gapMm, cut, numbers });
      const stamp = new Date().toISOString().slice(0, 10);
      triggerDownload(blob, `${safeName(campaignName)}-tiskovy-arch-${stamp}.pdf`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tisk selhal");
      setRunning(false);
      setPhase(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Printer className="h-4 w-4 text-emerald-600" aria-hidden />
              Tiskový arch
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              {itemIds.length.toLocaleString("cs-CZ")}{" "}
              {pluralPieces(itemIds.length)} na A4
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

        <div className="space-y-1">
          <label
            htmlFor="drop-print-gap"
            className="block text-xs font-medium text-gray-700"
          >
            Mezera mezi kartičkami —{" "}
            <span className="font-mono tabular-nums">{gapMm} mm</span>
          </label>
          <input
            id="drop-print-gap"
            type="range"
            min={0}
            max={12}
            step={1}
            value={gapMm}
            onChange={(e) => setGapMm(Number(e.target.value))}
            className="w-full accent-brand-600"
          />
          <p className="text-[11px] text-gray-400">
            Prostor na nůžky a na laminovací okraj. Větší mezera = míň kusů
            na stránku.
          </p>
        </div>

        <div className="space-y-1">
          <span className="block text-xs font-medium text-gray-700">
            Ořezové linky
          </span>
          <Seg
            value={cut}
            onChange={(v) => setCut(v as CutStyle)}
            options={CUT_OPTS}
          />
          {cut === "corners" && gapMm < 2 && (
            <p className="text-[11px] text-amber-700">
              Rohové značky se kreslí do mezery — při {gapMm} mm skončí na
              sousední kartičce. Přidej mezeru, nebo zvol rámeček.
            </p>
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={numbers}
            onChange={(e) => setNumbers(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
          />
          Číslo nálezu drobně vedle kartičky
        </label>
        <p className="-mt-2 pl-6 text-[11px] text-gray-400">
          Pomůcka pro rozdělení kusů mezi tým — po ustřižení na kartičce
          nezůstane.
        </p>

        {itemIds.length > BIG_BATCH && !running && (
          <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              {itemIds.length} kartiček ve 300 DPI je řádově{" "}
              {Math.round((itemIds.length * 0.9) / 10) * 10} MB a pár minut
              práce. Skládá se to v prohlížeči — okno nechej otevřené.
            </span>
          </p>
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
                  width: `${itemIds.length ? (done / itemIds.length) * 100 : 0}%`,
                }}
              />
            </div>
            <p className="flex items-center gap-2 text-xs text-gray-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {phase}
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={run}
            disabled={itemIds.length === 0}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800 transition hover:border-brand-400 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            Vygenerovat PDF
          </button>
        )}
      </div>
    </div>
  );
}

/** Row-packing layout so mixed card sizes still tile sensibly. */
async function buildSheet(
  cards: Rendered[],
  opts: { gapMm: number; cut: CutStyle; numbers: boolean },
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  const usableW = A4_W_MM - 2 * PAGE_MARGIN_MM;
  const usableH = A4_H_MM - 2 * PAGE_MARGIN_MM;
  const gap = opts.gapMm;

  let x = PAGE_MARGIN_MM;
  let y = PAGE_MARGIN_MM;
  let rowH = 0;
  let firstOnPage = true;

  for (const card of cards) {
    const w = card.sizeCm * 10;
    const h = w * (svgHeight(card.svg) / svgWidth(card.svg));

    // A single card taller or wider than the page is a configuration
    // mistake, not something to silently crop — say so.
    if (w > usableW || h > usableH) {
      throw new Error(
        `🍀 #${card.findId}: ${card.sizeCm} cm se na A4 nevejde, zmenši velikost tisku.`,
      );
    }

    if (!firstOnPage && x + w > PAGE_MARGIN_MM + usableW + 0.01) {
      x = PAGE_MARGIN_MM; // wrap to the next row
      y += rowH + gap;
      rowH = 0;
    }
    if (y + h > PAGE_MARGIN_MM + usableH + 0.01) {
      pdf.addPage();
      x = PAGE_MARGIN_MM;
      y = PAGE_MARGIN_MM;
      rowH = 0;
    }

    const scale = Math.max(1, ((w / 25.4) * PRINT_DPI) / svgWidth(card.svg));
    const dataUrl = await blobToDataUrl(await svgToPngBlob(card.svg, scale));
    pdf.addImage(dataUrl, "PNG", x, y, w, h);
    drawCutMarks(pdf, x, y, w, h, opts.cut, gap);
    if (opts.numbers) {
      pdf.setFontSize(5);
      pdf.setTextColor(150);
      pdf.text(String(card.findId), x, y - 0.8);
    }

    rowH = Math.max(rowH, h);
    x += w + gap;
    firstOnPage = false;
  }

  return pdf.output("blob");
}

/** Draws the chosen guide around one card. Corner marks sit OUTSIDE the
 *  card so nothing of them survives an accurate cut; the box hugs it. */
function drawCutMarks(
  pdf: import("jspdf").jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  style: CutStyle,
  gap: number,
) {
  if (style === "none") return;
  pdf.setDrawColor(160);
  pdf.setLineWidth(0.12);
  if (style === "box") {
    pdf.rect(x, y, w, h);
    return;
  }
  // Corner marks: keep them inside the gap so neighbouring cards' marks
  // never collide, and never longer than a third of the shorter side.
  const len = Math.min(gap > 0 ? gap * 0.8 : 2, Math.min(w, h) / 3, 3);
  const off = 0.4;
  const corners: Array<[number, number, number, number]> = [
    // top-left
    [x - off, y, x - off - len, y],
    [x, y - off, x, y - off - len],
    // top-right
    [x + w + off, y, x + w + off + len, y],
    [x + w, y - off, x + w, y - off - len],
    // bottom-left
    [x - off, y + h, x - off - len, y + h],
    [x, y + h + off, x, y + h + off + len],
    // bottom-right
    [x + w + off, y + h, x + w + off + len, y + h],
    [x + w, y + h + off, x + w, y + h + off + len],
  ];
  for (const [x1, y1, x2, y2] of corners) pdf.line(x1, y1, x2, y2);
}

function svgWidth(svg: string): number {
  return Number(/<svg[^>]*\swidth="(\d+)"/.exec(svg)?.[1] ?? 600);
}

function svgHeight(svg: string): number {
  return Number(/<svg[^>]*\sheight="(\d+)"/.exec(svg)?.[1] ?? svgWidth(svg));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Načtení obrázku selhalo"));
    r.readAsDataURL(blob);
  });
}

function safeName(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "sada"
  );
}

function pluralPieces(n: number): string {
  if (n === 1) return "kus";
  if (n < 5) return "kusy";
  return "kusů";
}
