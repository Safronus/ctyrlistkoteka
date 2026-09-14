import { triggerDownload } from "./qr-download";

/**
 * A single CaSQB code as a vector PDF, the page cut to the code.
 *
 * The other PDF (`qr-pdf.ts`) tiles a rasterised code across A4 for
 * cutting apart; this one hands a print shop the artwork itself — real
 * curves at any size, the page exactly the code plus a margin, so it drops
 * into a layout without cropping. svg2pdf.js draws the SVG's own shapes
 * into the PDF; a custom logo (always a PNG by then) is embedded as an
 * image, everything else stays vector.
 */
export interface CasqbPdfOpts {
  /** Width of the code including its quiet zone, mm. */
  widthMm: number;
  /** White around the code, mm. */
  marginMm?: number;
}

export async function generateCasqbVectorPdf(
  svg: string,
  filename: string,
  opts: CasqbPdfOpts,
): Promise<void> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([
    import("jspdf"),
    import("svg2pdf.js"),
  ]);
  const w = opts.widthMm;
  const m = opts.marginMm ?? 5;
  const page = w + 2 * m;
  const pdf = new jsPDF({ unit: "mm", format: [page, page], orientation: "portrait" });
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg") throw new Error("Neplatné SVG");
  await svg2pdf(root, pdf, { x: m, y: m, width: w, height: w });
  triggerDownload(pdf.output("blob"), filename);
}
