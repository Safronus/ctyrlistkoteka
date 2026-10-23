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

/** Options shared by the PNG rasterisers. */
export interface PngOpts {
  /** Drop the QR's painted background so the PNG keeps an alpha channel —
   *  the "průhledné pozadí" download option. See `stripBackgroundRect`. */
  transparent?: boolean;
}

export async function downloadPng(
  svg: string,
  filename: string,
  scale = 2,
  opts: PngOpts = {},
): Promise<void> {
  triggerDownload(await svgToPngBlob(svg, scale, opts), filename);
}

/**
 * Removes the full-canvas background both QR renderers paint as the very
 * first `<rect x="0" y="0" …>` of the SVG (`qr.ts` → `theme.bg`,
 * `casqbQr.ts` → `style.bg`).
 *
 * Safe to strip blindly: nothing else in either SVG starts at the origin —
 * data modules, finder/eye patterns, the panel border and the logo hole
 * all sit at a non-zero offset (padding or quiet zone) — so only the
 * background matches, and the code itself is left untouched. The `<svg>`
 * width/height stay in place, so the rasteriser still reads the same size.
 * A panel-border card keeps its tinted panel (that rect is inset, not at
 * 0,0); only the bleed around it turns transparent.
 */
export function stripBackgroundRect(svg: string): string {
  return svg.replace(
    /<rect x="0" y="0" width="[\d.]+" height="[\d.]+" fill="[^"]*"\s*\/>/,
    "",
  );
}

/** Rasterises an SVG string to a PNG Blob via an offscreen canvas.
 *  `scale` multiplies the SVG's intrinsic size for print-quality pixels.
 *  With `transparent`, the painted background is dropped first so the PNG
 *  carries an alpha channel instead of the theme's solid fill. */
export function svgToPngBlob(
  svg: string,
  scale: number,
  opts: PngOpts = {},
): Promise<Blob> {
  const source = opts.transparent ? stripBackgroundRect(svg) : svg;
  return new Promise((resolve, reject) => {
    const wMatch = source.match(/<svg[^>]*\swidth="(\d+)"/);
    const hMatch = source.match(/<svg[^>]*\sheight="(\d+)"/);
    const baseW = wMatch ? Number(wMatch[1]) : 600;
    const baseH = hMatch ? Number(hMatch[1]) : 800;

    const url = URL.createObjectURL(
      new Blob([source], { type: "image/svg+xml" }),
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
      // Never pre-fill the canvas: normally the SVG paints its own themed
      // background rect (so the dark-theme PNG stays dark, not white), and
      // in the transparent case that rect is gone and the untouched canvas
      // keeps its alpha channel.
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
