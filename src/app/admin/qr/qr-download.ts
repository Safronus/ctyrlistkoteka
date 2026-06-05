/**
 * Client-only download helpers shared by the QR generator form and the
 * evidence list. (Same approach as the per-find QR button: SVG goes out
 * as a blob; PNG is rasterised through an offscreen canvas so we don't
 * need a server-side rasteriser.)
 */

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke so the browser picks the URL up first (Safari is picky).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadSvg(svg: string, filename: string): void {
  triggerDownload(new Blob([svg], { type: "image/svg+xml" }), filename);
}

export async function downloadPng(
  svg: string,
  filename: string,
  scale = 2,
): Promise<void> {
  triggerDownload(await svgToPngBlob(svg, scale), filename);
}

/** Rasterises an SVG string to a PNG Blob via an offscreen canvas.
 *  `scale` multiplies the SVG's intrinsic size for print-quality pixels. */
export function svgToPngBlob(svg: string, scale: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
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
      // The SVG already paints its own (themed) background rect, so we
      // don't pre-fill — keeps the dark-theme PNG dark instead of white.
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
