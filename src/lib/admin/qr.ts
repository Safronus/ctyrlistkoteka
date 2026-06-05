import { readFileSync } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";

/**
 * SVG renderer for the admin QR features (per-find QR + the standalone
 * collection-QR generator).
 *
 * Style (locked in during the original find-QR design review):
 *   - Three corner finder patterns ALWAYS render as solid squares —
 *     scanners detect those geometrically, so they never degrade to a
 *     decorative shape regardless of the chosen module style.
 *   - Data/timing/alignment modules render in the chosen style: clover
 *     symbol (branded), plain square (classic) or dot. Contrast/spacing
 *     is enough for scanners.
 *   - An optional center image (brand clover or author smiley) sits in a
 *     carved-out hole; level-H error correction (~30 % recovery) covers
 *     the obscured modules.
 *
 * Reader note: scans cleanly head-on. The `dark` theme is light-on-dark
 * (inverted) — most modern scanners cope, but it's the least robust of
 * the three; print a `classic`/`brand` one when reliability matters.
 */

function readPngB64(file: string): string {
  try {
    const p = path.resolve(process.cwd(), "public", file);
    return readFileSync(p).toString("base64");
  } catch {
    return "";
  }
}
const QR_SMILEY_B64 = readPngB64("safronus.png");
const QR_CLOVER_B64 = readPngB64("clover.png");

export type QrTheme = "brand" | "classic" | "dark";
export type QrModuleStyle = "clover" | "square" | "dot";
export type QrCenter = "clover" | "smiley" | "none";
export type QrCenterScale = "sm" | "md";
export type QrSize = "sm" | "md" | "lg";

interface ThemeColors {
  bg: string;
  finder: string;
  module: string;
  title: string;
  caption: string;
  /** Pad behind the center image so modules don't crowd it. */
  hole: string;
}

const THEMES: Record<QrTheme, ThemeColors> = {
  // Branded green — matches the find QR (dark-green finders, lighter
  // clover modules) on white.
  brand: {
    bg: "#ffffff",
    finder: "#2f6230",
    module: "#4d9748",
    title: "#111827",
    caption: "#6b7280",
    hole: "#ffffff",
  },
  // Plain black-on-white — maximum scan reliability / print safety.
  classic: {
    bg: "#ffffff",
    finder: "#111827",
    module: "#111827",
    title: "#111827",
    caption: "#6b7280",
    hole: "#ffffff",
  },
  // Light-on-dark — looks sharp, slightly riskier to scan (inverted).
  dark: {
    bg: "#0c100e",
    finder: "#dff5e6",
    module: "#56c98a",
    title: "#f3f4f6",
    caption: "#9ca3af",
    hole: "#0c100e",
  },
};

const SIZE_PX: Record<QrSize, number> = { sm: 360, md: 594, lg: 900 };
const CENTER_FRAC: Record<QrCenterScale, number> = { sm: 0.24, md: 0.32 };

// Clover symbol uses `currentColor` so a single wrapping <g color=…>
// themes every clover module at once (and the vector-clover fallback
// for the center image).
const CLOVER_SYMBOL = `
  <symbol id="ctyr-qr-clover" viewBox="0 0 100 100">
    <g fill="currentColor">
      <ellipse cx="35" cy="35" rx="18" ry="22" transform="rotate(-45 35 35)"/>
      <ellipse cx="65" cy="35" rx="18" ry="22" transform="rotate(45 65 35)"/>
      <ellipse cx="35" cy="65" rx="18" ry="22" transform="rotate(45 35 65)"/>
      <ellipse cx="65" cy="65" rx="18" ry="22" transform="rotate(-45 65 65)"/>
    </g>
  </symbol>
`;

export interface RenderQrOpts {
  /** The URL the QR encodes. */
  url: string;
  /** Header text above the QR; null/empty → no title band. */
  title?: string | null;
  /** Caption text below the QR (e.g. friendly URL); null/empty → none. */
  caption?: string | null;
  theme?: QrTheme;
  moduleStyle?: QrModuleStyle;
  center?: QrCenter;
  centerScale?: QrCenterScale;
  size?: QrSize;
  /** Explicit target pixel width (wins over `size`). */
  targetQrPx?: number;
}

/** Fully self-contained SVG string (xml prolog + inline base64 images).
 *  Stream it as a Response, embed it, or rasterise to PNG on the client. */
export function renderQrSvg(opts: RenderQrOpts): string {
  const theme = THEMES[opts.theme ?? "brand"];
  const moduleStyle: QrModuleStyle = opts.moduleStyle ?? "clover";
  const center: QrCenter = opts.center ?? "clover";
  const centerFrac = CENTER_FRAC[opts.centerScale ?? "md"];
  const targetQrPx = opts.targetQrPx ?? SIZE_PX[opts.size ?? "md"];
  const title = opts.title && opts.title.trim() ? opts.title.trim() : null;
  const caption =
    opts.caption && opts.caption.trim() ? opts.caption.trim() : null;

  const qr = QRCode.create(opts.url, { errorCorrectionLevel: "H" });
  const SIZE = qr.modules.size;
  const data = qr.modules.data;
  const isDark = (r: number, c: number) => data[r * SIZE + c] === 1;
  const inFinderArea = (r: number, c: number) =>
    (r < 8 && c < 8) ||
    (r < 8 && c >= SIZE - 8) ||
    (r >= SIZE - 8 && c < 8);

  const MODULE = Math.max(1, Math.floor(targetQrPx / SIZE));
  const QR_PX = SIZE * MODULE;
  const PADDING = 16;
  const HEADER_H = title ? 56 : 0;
  const HEADER_FONT = 36;
  const FOOTER_H = caption ? 40 : 0;
  const FOOTER_FONT = 22;
  const CARD_W = QR_PX + PADDING * 2;
  const CARD_H = HEADER_H + PADDING + QR_PX + PADDING + FOOTER_H;
  const qrTop = HEADER_H + PADDING;

  const hasCenter = center !== "none";
  const centerD = hasCenter ? Math.round(QR_PX * centerFrac) : 0;
  const centerX = PADDING + (QR_PX - centerD) / 2;
  const centerY = qrTop + (QR_PX - centerD) / 2;
  const centerHalfModules = hasCenter
    ? Math.ceil(centerD / (2 * MODULE)) + 1
    : 0;
  const centerModule = (SIZE - 1) / 2;
  const inHole = (r: number, c: number) =>
    hasCenter &&
    Math.abs(r - centerModule) <= centerHalfModules &&
    Math.abs(c - centerModule) <= centerHalfModules;

  const finders: string[] = [];
  const modules: string[] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!isDark(r, c)) continue;
      const x = PADDING + c * MODULE;
      const y = qrTop + r * MODULE;
      if (inFinderArea(r, c)) {
        finders.push(
          `<rect x="${x}" y="${y}" width="${MODULE}" height="${MODULE}"/>`,
        );
      } else if (!inHole(r, c)) {
        if (moduleStyle === "square") {
          modules.push(
            `<rect x="${x}" y="${y}" width="${MODULE}" height="${MODULE}"/>`,
          );
        } else if (moduleStyle === "dot") {
          modules.push(
            `<circle cx="${x + MODULE / 2}" cy="${y + MODULE / 2}" r="${(
              MODULE * 0.42
            ).toFixed(2)}"/>`,
          );
        } else {
          modules.push(
            `<use href="#ctyr-qr-clover" x="${x}" y="${y}" width="${MODULE}" height="${MODULE}"/>`,
          );
        }
      }
    }
  }

  let centerSvg = "";
  if (hasCenter) {
    const pad = MODULE;
    centerSvg += `<rect x="${centerX - pad}" y="${centerY - pad}" width="${
      centerD + pad * 2
    }" height="${centerD + pad * 2}" rx="${pad}" fill="${theme.hole}"/>`;
    const b64 = center === "smiley" ? QR_SMILEY_B64 : QR_CLOVER_B64;
    if (b64) {
      centerSvg += `<image href="data:image/png;base64,${b64}" x="${centerX}" y="${centerY}" width="${centerD}" height="${centerD}"/>`;
    } else {
      // Missing public image → vector clover fallback in the module hue.
      centerSvg += `<g color="${theme.module}"><use href="#ctyr-qr-clover" x="${centerX}" y="${centerY}" width="${centerD}" height="${centerD}"/></g>`;
    }
  }

  const titleSvg = title
    ? `<text x="${CARD_W / 2}" y="${
        HEADER_H / 2 + HEADER_FONT / 3
      }" text-anchor="middle" font-size="${HEADER_FONT}" font-weight="700" fill="${theme.title}" letter-spacing="-1">${escapeXml(title)}</text>`
    : "";
  const captionSvg = caption
    ? `<text x="${CARD_W / 2}" y="${
        HEADER_H + PADDING + QR_PX + PADDING + FOOTER_H * 0.62
      }" text-anchor="middle" font-size="${FOOTER_FONT}" font-weight="500" fill="${theme.caption}">${escapeXml(caption)}</text>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}" font-family="Inter, system-ui, sans-serif">
  <defs>${CLOVER_SYMBOL}</defs>
  <rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="${theme.bg}"/>
  ${titleSvg}
  <g fill="${theme.finder}">
  ${finders.join("\n  ")}
  </g>
  <g fill="${theme.module}" color="${theme.module}">
  ${modules.join("\n  ")}
  </g>
  ${centerSvg}
  ${captionSvg}
</svg>
`;
}

export interface RenderFindQrOpts {
  /** Override the encoded URL. Defaults to
   *  `${NEXT_PUBLIC_SITE_URL}/sbirka/<findId>`. */
  url?: string;
  /** Override the header text. Defaults to `#<findId>`. */
  header?: string;
  /** Target QR pixel width. Default 594 — matches the design mockup. */
  targetQrPx?: number;
}

/** Per-find QR — the original branded style (green clover modules + the
 *  author smiley centre + `#<id>` header). Thin wrapper over renderQrSvg
 *  so the find-detail QR is unchanged. */
export function renderFindQrSvg(
  findId: number,
  opts: RenderFindQrOpts = {},
): string {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://ctyrlistkoteka.cz";
  const url = opts.url ?? `${siteUrl.replace(/\/$/, "")}/sbirka/${findId}`;
  return renderQrSvg({
    url,
    title: opts.header ?? `#${findId}`,
    theme: "brand",
    moduleStyle: "clover",
    center: "smiley",
    centerScale: "md",
    targetQrPx: opts.targetQrPx ?? 594,
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
