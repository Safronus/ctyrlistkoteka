import { readFileSync } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";

/**
 * SVG renderer for the admin "QR for find" feature.
 *
 * Style locked in during the design review (see
 * `scripts/mockups/qr-real.mjs` for the iteration history):
 *   - Three corner finder patterns render as solid dark-green
 *     squares (#2f6230) because scanners detect those geometrically.
 *   - Everything else (timing, alignment, dark-module, data) renders
 *     as the favicon four-leaf-clover symbol in the lighter green
 *     (#4d9748). Alternation/contrast is enough for scanners.
 *   - Center carves out a square hole and drops the Safronus smiley
 *     in. Level H error correction (~30 % recovery) covers it.
 *
 * Reader: scans cleanly head-on; under steep angle the missing
 * solid alignment pattern can cause failures. Acceptable for admin
 * use (operator can re-shoot / re-aim).
 */

const QR_SAFRONUS_B64: string = (() => {
  try {
    const p = path.resolve(process.cwd(), "public", "safronus.png");
    return readFileSync(p).toString("base64");
  } catch {
    return "";
  }
})();

// Alignment-pattern center positions per QR version (ISO/IEC 18004
// table). Covers up to v15 which is far beyond anything our URLs
// reach — the demo `/sbirka/<id>` fits in v5 at level H.
const ALIGN_POSITIONS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
  11: [6, 30, 54],
  12: [6, 32, 58],
  13: [6, 34, 62],
  14: [6, 26, 46, 66],
  15: [6, 26, 48, 70],
};

const CLOVER_SYMBOL = `
  <symbol id="ctyr-qr-clover" viewBox="0 0 100 100">
    <g fill="#4d9748">
      <ellipse cx="35" cy="35" rx="18" ry="22" transform="rotate(-45 35 35)"/>
      <ellipse cx="65" cy="35" rx="18" ry="22" transform="rotate(45 65 35)"/>
      <ellipse cx="35" cy="65" rx="18" ry="22" transform="rotate(45 35 65)"/>
      <ellipse cx="65" cy="65" rx="18" ry="22" transform="rotate(-45 65 65)"/>
    </g>
  </symbol>
`;

export interface RenderFindQrOpts {
  /** Override the encoded URL. Defaults to
   *  `${NEXT_PUBLIC_SITE_URL}/sbirka/<findId>`. */
  url?: string;
  /** Override the header text shown above the QR. Defaults to
   *  `#<findId>`. */
  header?: string;
  /** Target QR pixel width (the module size adapts to keep the
   *  total close to this). Default 594 — matches the design mockup
   *  and reads well both on-screen at 1× and printed. */
  targetQrPx?: number;
}

/** Returns a fully self-contained SVG string (xml-prolog + inline
 *  base64 smiley). Caller can stream it as a Response, embed it in
 *  another component, or convert to PNG on the client via canvas. */
export function renderFindQrSvg(
  findId: number,
  opts: RenderFindQrOpts = {},
): string {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://ctyrlistkoteka.cz";
  const url =
    opts.url ?? `${siteUrl.replace(/\/$/, "")}/sbirka/${findId}`;
  const header = opts.header ?? `#${findId}`;
  const targetQrPx = opts.targetQrPx ?? 594;

  const qr = QRCode.create(url, { errorCorrectionLevel: "H" });
  const SIZE = qr.modules.size;
  const VERSION = qr.version;
  const data = qr.modules.data;

  const isDark = (r: number, c: number) => data[r * SIZE + c] === 1;

  // Only finder patterns force solid squares — see file header for
  // why timing/alignment/dark-module can degrade to clovers.
  const inFinderArea = (r: number, c: number) =>
    (r < 8 && c < 8) ||
    (r < 8 && c >= SIZE - 8) ||
    (r >= SIZE - 8 && c < 8);

  // Geometry — sized for a printed sticker / card. The header band
  // used to be 90 px tall with 56 px text, making the card visibly
  // taller than wide (632×722, awkward when laminating onto square
  // clover cards). Tighter HEADER_H + smaller font lands at ~1:1.07
  // aspect, which prints cleanly onto a 6×6 cm clover card with
  // room for the find-ID line above.
  const MODULE = Math.floor(targetQrPx / SIZE);
  const QR_PX = SIZE * MODULE;
  const PADDING = 16;
  const CARD_W = QR_PX + PADDING * 2;
  const HEADER_H = 56;
  const HEADER_FONT = 36;
  const CARD_H = HEADER_H + QR_PX + PADDING * 2;

  // Center smiley hole — 32 % per design review. Padded by 1 module
  // so clovers don't visually kiss the smiley edge.
  const smileyD = Math.round(QR_PX * 0.32);
  const smileyX = PADDING + (QR_PX - smileyD) / 2;
  const smileyY = HEADER_H + PADDING + (QR_PX - smileyD) / 2;
  const smileyHalfModules = Math.ceil(smileyD / (2 * MODULE)) + 1;
  const centerModule = (SIZE - 1) / 2;
  const inSmileyHole = (r: number, c: number) =>
    Math.abs(r - centerModule) <= smileyHalfModules &&
    Math.abs(c - centerModule) <= smileyHalfModules;

  const structuralSquares: string[] = [];
  const cloverUses: string[] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!isDark(r, c)) continue;
      const x = PADDING + c * MODULE;
      const y = HEADER_H + PADDING + r * MODULE;
      if (inFinderArea(r, c)) {
        structuralSquares.push(
          `<rect x="${x}" y="${y}" width="${MODULE}" height="${MODULE}" fill="#2f6230"/>`,
        );
      } else if (!inSmileyHole(r, c)) {
        cloverUses.push(
          `<use href="#ctyr-qr-clover" x="${x}" y="${y}" width="${MODULE}" height="${MODULE}"/>`,
        );
      }
    }
  }

  // Suppress unused-variable warning for `VERSION` — it's read here
  // purely so the ESLint rule keeps us honest about pulling it out
  // of the qrcode object in case we later need version-aware logic.
  void VERSION;
  void ALIGN_POSITIONS;

  const smileyImage = QR_SAFRONUS_B64
    ? `<image href="data:image/png;base64,${QR_SAFRONUS_B64}" x="${smileyX}" y="${smileyY}" width="${smileyD}" height="${smileyD}"/>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}" font-family="Inter, system-ui, sans-serif">
  <defs>${CLOVER_SYMBOL}</defs>
  <rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="#ffffff"/>
  <text x="${CARD_W / 2}" y="${HEADER_H / 2 + HEADER_FONT / 3}" text-anchor="middle" font-size="${HEADER_FONT}" font-weight="700" fill="#111827" letter-spacing="-1">${escapeXml(header)}</text>
  ${structuralSquares.join("\n  ")}
  ${cloverUses.join("\n  ")}
  ${smileyImage}
</svg>
`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
