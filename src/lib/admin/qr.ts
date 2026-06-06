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
 *   - Data modules render in the chosen style: clover symbol (branded),
 *     plain square (classic) or dot.
 *   - An optional center image (brand clover or author smiley) sits in a
 *     carved-out hole; level-H error correction covers the obscured cells.
 *   - The title auto-fits the QR width: it shrinks to a floor font, then
 *     wraps onto multiple word-broken lines, so long names never clip.
 *
 * Reader note: the `dark` theme is light-on-dark (inverted) — most modern
 * scanners cope, but print a `classic`/`brand` one when it must be robust.
 */

function readPngB64(file: string): string {
  try {
    return readFileSync(path.resolve(process.cwd(), "public", file)).toString(
      "base64",
    );
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
export type QrBorder = "none" | "frame" | "panel" | "cut";
export type QrBorderRadius = "soft" | "round";
export type QrBorderColor = "theme" | "gray";

interface ThemeColors {
  bg: string;
  finder: string;
  module: string;
  title: string;
  caption: string;
  /** Pad behind the center image so modules don't crowd it. */
  hole: string;
  /** Fill for the "panel" border. */
  panel: string;
  /** Stroke around the "panel" so it reads as a distinct chip. */
  panelBorder: string;
}

const THEMES: Record<QrTheme, ThemeColors> = {
  brand: {
    bg: "#ffffff",
    finder: "#2f6230",
    module: "#4d9748",
    title: "#111827",
    caption: "#6b7280",
    hole: "#ffffff",
    panel: "#e3f2e8",
    panelBorder: "#b7dcc4",
  },
  classic: {
    bg: "#ffffff",
    finder: "#111827",
    module: "#111827",
    title: "#111827",
    caption: "#6b7280",
    hole: "#ffffff",
    panel: "#eef1f4",
    panelBorder: "#d1d5db",
  },
  dark: {
    bg: "#0c100e",
    finder: "#dff5e6",
    module: "#56c98a",
    title: "#f3f4f6",
    caption: "#9ca3af",
    hole: "#0c100e",
    panel: "#1a231d",
    panelBorder: "#324036",
  },
};

const SIZE_PX: Record<QrSize, number> = { sm: 360, md: 594, lg: 900 };
const CENTER_FRAC: Record<QrCenterScale, number> = { sm: 0.24, md: 0.32 };

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
  url: string;
  title?: string | null;
  caption?: string | null;
  theme?: QrTheme;
  moduleStyle?: QrModuleStyle;
  center?: QrCenter;
  centerScale?: QrCenterScale;
  size?: QrSize;
  border?: QrBorder;
  borderRadius?: QrBorderRadius;
  borderColor?: QrBorderColor;
  /** Explicit target pixel width (wins over `size`). */
  targetQrPx?: number;
}

/** Word-aware title fit: largest single-line font that fits, else wrap by
 *  words at the floor font. Width is estimated from the char count (no DOM
 *  to measure with) — a slight overestimate, so it errs toward wrapping
 *  rather than clipping. */
function layoutTitle(
  text: string,
  maxWidth: number,
  maxFont: number,
  minFont: number,
): { fontSize: number; lines: string[] } {
  const widthAt = (s: string, fs: number) => s.length * fs * 0.56;
  for (let fs = maxFont; fs >= minFont; fs -= 2) {
    if (widthAt(text, fs) <= maxWidth) return { fontSize: fs, lines: [text] };
  }
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (!cur || widthAt(trial, minFont) <= maxWidth) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return { fontSize: minFont, lines: lines.length ? lines : [text] };
}

/** Fully self-contained SVG string (xml prolog + inline base64 images). */
export function renderQrSvg(opts: RenderQrOpts): string {
  const theme = THEMES[opts.theme ?? "brand"];
  const moduleStyle: QrModuleStyle = opts.moduleStyle ?? "clover";
  const center: QrCenter = opts.center ?? "clover";
  const centerFrac = CENTER_FRAC[opts.centerScale ?? "md"];
  const targetQrPx = opts.targetQrPx ?? SIZE_PX[opts.size ?? "md"];
  const border: QrBorder = opts.border ?? "none";
  const borderRadius: QrBorderRadius = opts.borderRadius ?? "soft";
  const borderColor: QrBorderColor = opts.borderColor ?? "theme";
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
  const contentW = QR_PX + PADDING * 2;

  const titleLayout = title ? layoutTitle(title, QR_PX, 36, 18) : null;
  const lineH = titleLayout ? Math.round(titleLayout.fontSize * 1.18) : 0;
  const HEADER_H = titleLayout ? lineH * titleLayout.lines.length + 22 : 0;
  const FOOTER_H = caption ? 40 : 0;
  const FOOTER_FONT = 22;
  const qrTop = HEADER_H + PADDING;
  const contentH = HEADER_H + PADDING + QR_PX + PADDING + FOOTER_H;

  // Outer margin for a border so the frame/panel/cut line has room.
  const BM = border === "none" ? 0 : 22;
  const CARD_W = contentW + BM * 2;
  const CARD_H = contentH + BM * 2;

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
    // With the "panel" border, the centre image's backing pad picks up the
    // panel tint too, so it blends into the panel instead of being a white
    // patch in the middle of the tinted card.
    const holeFill = border === "panel" ? theme.panel : theme.hole;
    centerSvg += `<rect x="${centerX - pad}" y="${centerY - pad}" width="${
      centerD + pad * 2
    }" height="${centerD + pad * 2}" rx="${pad}" fill="${holeFill}"/>`;
    const b64 = center === "smiley" ? QR_SMILEY_B64 : QR_CLOVER_B64;
    if (b64) {
      centerSvg += `<image href="data:image/png;base64,${b64}" x="${centerX}" y="${centerY}" width="${centerD}" height="${centerD}"/>`;
    } else {
      centerSvg += `<g color="${theme.module}"><use href="#ctyr-qr-clover" x="${centerX}" y="${centerY}" width="${centerD}" height="${centerD}"/></g>`;
    }
  }

  const titleSvg = titleLayout
    ? (() => {
        const blockH = lineH * titleLayout.lines.length;
        const firstBaseline =
          (HEADER_H - blockH) / 2 + titleLayout.fontSize * 0.8;
        return titleLayout.lines
          .map(
            (line, i) =>
              `<text x="${contentW / 2}" y="${
                firstBaseline + i * lineH
              }" text-anchor="middle" font-size="${titleLayout.fontSize}" font-weight="700" fill="${theme.title}" letter-spacing="-0.5">${escapeXml(
                line,
              )}</text>`,
          )
          .join("\n  ");
      })()
    : "";
  const captionSvg = caption
    ? `<text x="${contentW / 2}" y="${
        HEADER_H + PADDING + QR_PX + PADDING + FOOTER_H * 0.62
      }" text-anchor="middle" font-size="${FOOTER_FONT}" font-weight="500" fill="${theme.caption}">${escapeXml(caption)}</text>`
    : "";

  // Border decorations (drawn in CARD coordinates, around the content).
  const R = borderRadius === "round" ? 40 : 18;
  const inset = BM * 0.5;
  const bx = inset;
  const by = inset;
  const bw = CARD_W - inset * 2;
  const bh = CARD_H - inset * 2;
  const lineHex = borderColor === "gray" ? "#9ca3af" : theme.finder;
  let panelSvg = "";
  let borderSvg = "";
  if (border === "panel") {
    panelSvg = `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${R}" fill="${theme.panel}" stroke="${theme.panelBorder}" stroke-width="2"/>`;
  } else if (border === "frame") {
    borderSvg = `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${R}" fill="none" stroke="${
      borderColor === "gray" ? "#cbd5e1" : theme.finder
    }" stroke-width="3"/>`;
  } else if (border === "cut") {
    borderSvg = `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${R}" fill="none" stroke="${lineHex}" stroke-width="2" stroke-dasharray="9 7"/>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif">
  <defs>${CLOVER_SYMBOL}</defs>
  <rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="${theme.bg}"/>
  ${panelSvg}
  <g transform="translate(${BM} ${BM})">
  ${titleSvg}
  <g fill="${theme.finder}">
  ${finders.join("\n  ")}
  </g>
  <g fill="${theme.module}" color="${theme.module}">
  ${modules.join("\n  ")}
  </g>
  ${centerSvg}
  ${captionSvg}
  </g>
  ${borderSvg}
</svg>
`;
}

export interface RenderFindQrOpts {
  url?: string;
  header?: string;
  targetQrPx?: number;
}

/** Per-find QR — the original branded style (green clover modules + the
 *  author smiley centre + `#<id>` header). Thin wrapper over renderQrSvg. */
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
