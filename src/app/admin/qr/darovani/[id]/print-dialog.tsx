"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2, Printer, X } from "lucide-react";
import { renderDropQrBatchAction } from "../../drop-actions";
import { svgToPngBlob, triggerDownload } from "../../qr-download";
import { Seg } from "../../qr-ui";
import {
  BACK_LINE_FACTOR,
  backTextRect,
  backTextTop,
  mirrorCell,
  planSheet,
  type BackPos,
  type CutStyle,
  type FlipAxis,
  type SheetOpts,
} from "@/lib/printSheet";

/**
 * The print sheet: a wave of cards laid out on A4, ready to cut.
 *
 * Assembled entirely in the BROWSER, like every other QR export here, and
 * for the same hard reason: card titles carry a 🍀 and the VPS has no
 * colour-emoji font, so a server-side rasteriser would print a
 * missing-glyph box on exactly the batch destined for scissors. The back
 * side's text is rastered here too — jsPDF's built-in fonts are WinAnsi
 * and would turn "Čtyřlístkotéka" into mush.
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

const CUT_OPTS = [
  { v: "corners", l: "Rohové značky", title: "Krátké čárky v rozích, mimo kartičku" },
  { v: "box", l: "Rámeček", title: "Souvislá linka kolem kartičky" },
  { v: "none", l: "Žádné", title: "Jen kartičky, bez vodítek" },
];

const FLIP_OPTS = [
  {
    v: "long",
    l: "Podél delší hrany",
    title: "Obvyklé nastavení tiskárny — papír se otáčí jako stránka v knize",
  },
  {
    v: "short",
    l: "Podél kratší hrany",
    title: "Papír se otáčí jako blok — obrací se horní a dolní okraj",
  },
];

const BACK_POS_OPTS = [
  { v: "top", l: "K hornímu okraji" },
  { v: "bottom", l: "K dolnímu okraji" },
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
  pxPerCm,
  onClose,
}: {
  itemIds: number[];
  campaignName: string;
  /** Measured screen calibration, so the preview is life-size. */
  pxPerCm: number;
  onClose: () => void;
}) {
  const [gapMm, setGapMm] = useState(4);
  const [cut, setCut] = useState<CutStyle>("corners");
  const [numbers, setNumbers] = useState(false);
  const [padTopMm, setPadTopMm] = useState(0);
  const [padBottomMm, setPadBottomMm] = useState(0);
  const [backOn, setBackOn] = useState(false);
  const [backText, setBackText] = useState("ctyrlistkoteka.cz");
  const [backPos, setBackPos] = useState<BackPos>("bottom");
  const [backOffsetMm, setBackOffsetMm] = useState(0);
  const [backSizeMm, setBackSizeMm] = useState(3);
  const [flip, setFlip] = useState<FlipAxis>("long");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The first selected card, rendered once, purely to be looked at. */
  const [sample, setSample] = useState<Rendered | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !running) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  // One card up front: the preview must show the real thing, and the
  // batch render is the same call the sheet itself makes.
  useEffect(() => {
    const first = itemIds[0];
    if (first === undefined) return;
    let live = true;
    void (async () => {
      const r = await renderDropQrBatchAction([first]);
      if (live && r.ok && r.items[0]) setSample(r.items[0]);
    })();
    return () => {
      live = false;
    };
  }, [itemIds]);

  const opts: SheetOpts = {
    gapMm,
    cut,
    numbers,
    padTopMm,
    padBottomMm,
    back: backOn
      ? {
          text: backText,
          pos: backPos,
          offsetMm: backOffsetMm,
          sizeMm: backSizeMm,
          flip,
        }
      : null,
  };

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
      const blob = await buildSheet(cards, opts);
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
    <div className="fixed inset-0 z-[1100] flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-auto w-full max-w-3xl space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
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

        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="space-y-4">
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
                Prostor na nůžky a na laminovací okraj. Větší mezera = míň
                kusů na stránku.
              </p>
            </div>

            {/* ------------------------------------------- free space */}
            <div className="space-y-1 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
              <p className="text-xs font-medium text-gray-700">
                Volné místo u kartičky
              </p>
              <p className="mb-2 text-[11px] text-gray-400">
                Prázdný pruh, který se ustřihne <strong>spolu</strong> s
                kartičkou — na dírkovačku, na přeložení nebo na ruční
                popisek. Ořezová linka jde kolem něj.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[11px] text-gray-600">
                  Nad —{" "}
                  <span className="font-mono tabular-nums">{padTopMm} mm</span>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    step={1}
                    value={padTopMm}
                    onChange={(e) => setPadTopMm(Number(e.target.value))}
                    className="mt-1 w-full accent-brand-600"
                  />
                </label>
                <label className="block text-[11px] text-gray-600">
                  Pod —{" "}
                  <span className="font-mono tabular-nums">
                    {padBottomMm} mm
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    step={1}
                    value={padBottomMm}
                    onChange={(e) => setPadBottomMm(Number(e.target.value))}
                    className="mt-1 w-full accent-brand-600"
                  />
                </label>
              </div>
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

            <div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={numbers}
                  onChange={(e) => setNumbers(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
                />
                Číslo nálezu drobně vedle kartičky
              </label>
              <p className="pl-6 text-[11px] text-gray-400">
                Pomůcka pro rozdělení kusů mezi tým — po ustřižení na
                kartičce nezůstane.
              </p>
            </div>

            {/* ------------------------------------------- the back side */}
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={backOn}
                  onChange={(e) => setBackOn(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
                />
                Text na zadní straně (oboustranný tisk)
              </label>
              <p className="pl-6 text-[11px] text-gray-400">
                Za každou stránku s kartičkami se vloží druhá, zrcadlově
                otočená. V tiskárně zvol oboustranný tisk — text pak sedí na
                rubu té správné kartičky.
              </p>

              {backOn && (
                <div className="space-y-3 pl-6 pt-1">
                  <label className="block text-[11px] text-gray-600">
                    Co se vytiskne
                    <input
                      value={backText}
                      onChange={(e) => setBackText(e.target.value)}
                      maxLength={80}
                      className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                    />
                  </label>
                  <div className="space-y-1">
                    <span className="block text-[11px] text-gray-600">
                      Kam
                    </span>
                    <Seg
                      value={backPos}
                      onChange={(v) => setBackPos(v as BackPos)}
                      options={BACK_POS_OPTS}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-[11px] text-gray-600">
                      Posun od okraje —{" "}
                      <span className="font-mono tabular-nums">
                        {backOffsetMm > 0 ? "+" : ""}
                        {backOffsetMm.toFixed(1)} mm
                      </span>
                      <input
                        type="range"
                        min={-2}
                        max={2}
                        step={0.5}
                        value={backOffsetMm}
                        onChange={(e) =>
                          setBackOffsetMm(Number(e.target.value))
                        }
                        className="mt-1 w-full accent-brand-600"
                      />
                    </label>
                    <label className="block text-[11px] text-gray-600">
                      Velikost písma —{" "}
                      <span className="font-mono tabular-nums">
                        {backSizeMm} mm
                      </span>
                      <input
                        type="range"
                        min={2}
                        max={8}
                        step={0.5}
                        value={backSizeMm}
                        onChange={(e) => setBackSizeMm(Number(e.target.value))}
                        className="mt-1 w-full accent-brand-600"
                      />
                    </label>
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Papír se v tiskárně nikdy netrefí na desetinu milimetru;
                    posun je na doladění po první zkoušce.
                  </p>
                  <div className="space-y-1">
                    <span className="block text-[11px] text-gray-600">
                      Jak tiskárna otáčí papír
                    </span>
                    <Seg
                      value={flip}
                      onChange={(v) => setFlip(v as FlipAxis)}
                      options={FLIP_OPTS}
                    />
                    <p className="text-[11px] text-gray-400">
                      Špatná volba otočí rub o celý arch — pozná se hned na
                      první zkušební stránce.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ------------------------------------------------ the preview */}
          <SheetPreview sample={sample} opts={opts} pxPerCm={pxPerCm} />
        </div>

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

/**
 * One finished card at its real size — with the free space, the cut line
 * and, when it is on, the back.
 *
 * The sliders above are millimetres, and millimetres are exactly the thing
 * nobody can picture. Everything here is drawn from the same numbers the
 * PDF uses, at the screen's measured px-per-cm, so what is on the monitor
 * is what comes out of the printer.
 */
function SheetPreview({
  sample,
  opts,
  pxPerCm,
}: {
  sample: Rendered | null;
  opts: SheetOpts;
  pxPerCm: number;
}) {
  const mm = (v: number) => (v / 10) * pxPerCm;

  if (!sample) {
    return (
      <div className="flex min-h-[12rem] items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
        <Loader2 className="h-5 w-5 animate-spin text-gray-300" aria-hidden />
      </div>
    );
  }

  const wPx = sample.sizeCm * pxPerCm;
  const ratio = svgHeight(sample.svg) / svgWidth(sample.svg);
  const cardHPx = wPx * ratio;
  const cellHPx = cardHPx + mm(opts.padTopMm) + mm(opts.padBottomMm);
  const back = opts.back;
  // Straight from the layout the PDF uses, in millimetres, converted to
  // px last — a preview that computes its own placement is a preview that
  // eventually disagrees with the print.
  const backTop =
    back === null
      ? 0
      : mm(
          backTextTop(
            0,
            cellHPx / (pxPerCm / 10),
            back.sizeMm * BACK_LINE_FACTOR,
            back,
          ),
        );

  return (
    <div className="space-y-1.5">
      <p className="flex items-baseline justify-between gap-2 text-xs font-medium text-gray-700">
        Jedna hotová kartička
        <span className="font-normal text-[11px] text-gray-400">
          🍀 #{sample.findId}
        </span>
      </p>

      <div className="flex flex-wrap items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div>
          <div
            className={
              opts.cut === "box"
                ? "border border-gray-400"
                : "border border-dashed border-gray-200"
            }
            style={{ width: `${wPx}px`, height: `${cellHPx}px` }}
          >
            <div
              className="[&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
              style={{ marginTop: `${mm(opts.padTopMm)}px` }}
              dangerouslySetInnerHTML={{ __html: sample.svg }}
            />
          </div>
          <p className="mt-1 text-center text-[10px] text-gray-400">
            Přední strana
          </p>
        </div>

        {back && (
          <div>
            <div
              className="relative border border-dashed border-gray-200 bg-gray-50"
              style={{ width: `${wPx}px`, height: `${cellHPx}px` }}
            >
              <span
                className="absolute left-0 right-0 text-center leading-none text-gray-800"
                style={{
                  top: `${backTop}px`,
                  fontSize: `${mm(back.sizeMm)}px`,
                }}
              >
                {back.text}
              </span>
            </div>
            <p className="mt-1 text-center text-[10px] text-gray-400">
              Zadní strana
            </p>
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400">
        {sample.sizeCm} cm ve skutečné velikosti
        {opts.padTopMm + opts.padBottomMm > 0 && (
          <>
            {" "}
            · ustřihne se celý obdélník, tedy i {opts.padTopMm} mm nad a{" "}
            {opts.padBottomMm} mm pod kartičkou
          </>
        )}
      </p>
    </div>
  );
}

/** Renders the planned sheet: fronts, and a mirrored back page after
 *  each one when the operator asked for it. */
async function buildSheet(
  cards: Rendered[],
  opts: SheetOpts,
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  const pages = planSheet(
    cards.map((card) => ({
      findId: card.findId,
      sizeCm: card.sizeCm,
      aspect: svgHeight(card.svg) / svgWidth(card.svg),
      svg: card.svg,
    })),
    opts,
  );
  // The back text is one raster reused on every card — same string, same
  // size, and rendering it per card would be a hundred canvases.
  const backImg = opts.back
    ? await textToPng(opts.back.text, opts.back.sizeMm)
    : null;

  let firstPage = true;
  for (const page of pages) {
    if (!firstPage) pdf.addPage();
    firstPage = false;

    for (const p of page) {
      const scale = Math.max(
        1,
        ((p.w / 25.4) * PRINT_DPI) / svgWidth(p.card.svg),
      );
      const dataUrl = await blobToDataUrl(await svgToPngBlob(p.card.svg, scale));
      pdf.addImage(dataUrl, "PNG", p.x, p.y + opts.padTopMm, p.w, p.h);
      drawCutMarks(pdf, p.x, p.y, p.w, p.cellH, opts.cut, opts.gapMm);
      if (opts.numbers) {
        pdf.setFontSize(5);
        pdf.setTextColor(150);
        pdf.text(String(p.card.findId), p.x, p.y - 0.8);
      }
    }

    if (opts.back && backImg) {
      pdf.addPage();
      for (const p of page) {
        const cell = mirrorCell(p, opts.back.flip);
        const r = backTextRect(p, backImg, opts.back);
        pdf.addImage(backImg.dataUrl, "PNG", r.x, r.y, r.w, r.h);
        drawCutMarks(pdf, cell.x, cell.y, p.w, p.cellH, opts.cut, opts.gapMm);
      }
    }
  }

  return pdf.output("blob");
}

/**
 * The back text as a transparent PNG.
 *
 * Not `pdf.text()`: jsPDF's built-in fonts are WinAnsi, which has no č, ř,
 * š, ž or ě — the wave's own name would print as mush. The browser has the
 * fonts and the emoji, so it draws, exactly as the cards themselves do.
 */
async function textToPng(
  text: string,
  sizeMm: number,
): Promise<{ dataUrl: string; wMm: number; hMm: number }> {
  const pxPerMm = PRINT_DPI / 25.4;
  const fontPx = Math.max(4, Math.round(sizeMm * pxPerMm));
  const family =
    getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  const font = `${fontPx}px ${family}`;

  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("Vykreslení textu selhalo");
  measure.font = font;
  const textW = Math.ceil(measure.measureText(text).width);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, textW + 4);
  canvas.height = Math.ceil(fontPx * BACK_LINE_FACTOR);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Vykreslení textu selhalo");
  // Canvas state resets when the element is resized — set the font again.
  ctx.font = font;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#111827";
  ctx.fillText(text, 2, 0);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    wMm: canvas.width / pxPerMm,
    hMm: canvas.height / pxPerMm,
  };
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
