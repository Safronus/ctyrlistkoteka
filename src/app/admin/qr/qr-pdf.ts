import { triggerDownload, svgToPngBlob } from "./qr-download";

/**
 * Client-side A4 print sheet for a single QR: tiles N copies (or fills
 * the page) so the operator can print and cut them apart. jsPDF is
 * dynamically imported so it stays out of the main admin bundle.
 */
export interface QrPdfOpts {
  /** Width of each printed piece, mm. Height follows the QR's aspect. */
  pieceMm: number;
  /** Number of copies, or "fill" = pack one A4 page. */
  count: number | "fill";
  /** Draw a thin cut box around each piece. */
  cutGuides: boolean;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Načtení obrázku selhalo"));
    r.readAsDataURL(blob);
  });
}

export async function generateQrPdf(
  svg: string,
  filename: string,
  opts: QrPdfOpts,
): Promise<{ pages: number; total: number }> {
  const { jsPDF } = await import("jspdf");

  // Intrinsic aspect from the SVG root (always literal ints here).
  const wMatch = svg.match(/<svg[^>]*\swidth="(\d+)"/);
  const hMatch = svg.match(/<svg[^>]*\sheight="(\d+)"/);
  const baseW = wMatch ? Number(wMatch[1]) : 600;
  const baseH = hMatch ? Number(hMatch[1]) : 800;
  const aspect = baseH / baseW;

  const pieceW = opts.pieceMm;
  const pieceH = pieceW * aspect;

  // Rasterise once at ~300 DPI for the chosen physical width.
  const targetPx = Math.round((pieceW / 25.4) * 300);
  const scale = Math.max(1, targetPx / baseW);
  const pngDataUrl = await blobToDataUrl(await svgToPngBlob(svg, scale));

  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageW = 210;
  const pageH = 297;
  const margin = 8;
  const gap = opts.cutGuides ? 3 : 2;
  const usableW = pageW - 2 * margin;
  const usableH = pageH - 2 * margin;
  const cols = Math.max(1, Math.floor((usableW + gap) / (pieceW + gap)));
  const rows = Math.max(1, Math.floor((usableH + gap) / (pieceH + gap)));
  const perPage = cols * rows;
  const total = opts.count === "fill" ? perPage : Math.max(1, opts.count);

  for (let placed = 0; placed < total; placed++) {
    if (placed > 0 && placed % perPage === 0) pdf.addPage();
    const onPage = placed % perPage;
    const col = onPage % cols;
    const row = Math.floor(onPage / cols);
    const x = margin + col * (pieceW + gap);
    const y = margin + row * (pieceH + gap);
    pdf.addImage(pngDataUrl, "PNG", x, y, pieceW, pieceH);
    if (opts.cutGuides) {
      pdf.setDrawColor(180);
      pdf.setLineWidth(0.15);
      pdf.rect(x - gap / 2, y - gap / 2, pieceW + gap, pieceH + gap);
    }
  }

  triggerDownload(pdf.output("blob"), filename);
  return { pages: Math.ceil(total / perPage), total };
}
