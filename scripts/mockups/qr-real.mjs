#!/usr/bin/env node
// Real, scannable QR-code generator with clover dots + safronus
// smiley in the middle. Structural modules (finder patterns,
// timing patterns, alignment patterns, dark module) render as solid
// black squares — scanners hunt for those specific shapes to lock
// onto the code, so swapping them for clovers breaks readability.
// Only the *data* modules become clovers. Level H error correction
// (~30 % recovery) covers the smiley-shaped hole in the center.
//
// Usage:  node scripts/mockups/qr-real.mjs [findId]

import { writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const safronusPath = resolve(repoRoot, "public", "safronus.png");
const safronusB64 = readFileSync(safronusPath).toString("base64");

const findId = Number(process.argv[2] ?? 15900);
const url = `https://ctyrlistkoteka.cz/sbirka/${findId}`;

const qr = QRCode.create(url, { errorCorrectionLevel: "H" });
const SIZE = qr.modules.size;
const VERSION = qr.version;
const data = qr.modules.data;

function isDark(r, c) {
  return data[r * SIZE + c] === 1;
}

// ---------- Structural-module detection ----------
// QR standard reserves specific positions for finder, timing, and
// alignment patterns plus the always-dark module. Scanners locate
// these shapes geometrically; rendering them as anything other than
// solid squares of consistent fill confuses the locator pass and the
// code stops scanning.

// Finder patterns: three 7×7 blocks in TL, TR, BL corners, plus
// their 1-module-wide white "separator" border.
function inFinderArea(r, c) {
  return (
    (r < 8 && c < 8) ||
    (r < 8 && c >= SIZE - 8) ||
    (r >= SIZE - 8 && c < 8)
  );
}

// Timing patterns: alternating modules on row 6 and column 6 between
// the finder patterns. Always exist regardless of version.
function onTimingPattern(r, c) {
  return r === 6 || c === 6;
}

// Always-dark module: at (4·V + 9, 8). Part of format-info area but
// must stay solid black for the format decoder.
function isDarkModule(r, c) {
  return r === 4 * VERSION + 9 && c === 8;
}

// Alignment patterns: 5×5 blocks at specific centers per version.
// Table covers versions 1-15 which is well past anything our URLs
// produce (v5 holds the demo URL at level H with room to spare).
const ALIGN_POSITIONS = {
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
const alignCenters = [];
const positions = ALIGN_POSITIONS[VERSION] ?? [];
for (const ar of positions) {
  for (const ac of positions) {
    // Skip centers that would overlap a finder pattern region.
    const overlapsTL = ar <= 8 && ac <= 8;
    const overlapsTR = ar <= 8 && ac >= SIZE - 9;
    const overlapsBL = ar >= SIZE - 9 && ac <= 8;
    if (overlapsTL || overlapsTR || overlapsBL) continue;
    alignCenters.push([ar, ac]);
  }
}
function inAlignmentPattern(r, c) {
  for (const [ar, ac] of alignCenters) {
    if (Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2) return true;
  }
  return false;
}

// Only the three corner finder patterns stay solid black — they're
// the geometric locators every QR reader hunts for first. Everything
// else (timing modules, the lone "dark module", and the bottom-right
// alignment pattern) renders as clovers. This is at the edge of the
// spec: the alignment pattern in particular helps with perspective
// correction, so scans under a steep angle may fail. Reverting just
// alignment back to squares is a one-line flip if that becomes an
// issue in practice.
function isStructural(r, c) {
  return inFinderArea(r, c);
}

// ---------- SVG geometry ----------
const TARGET_QR_PX = 594;
const MODULE = Math.floor(TARGET_QR_PX / SIZE);
const QR_PX = SIZE * MODULE;
const PADDING = 20;
const CARD_W = QR_PX + PADDING * 2;
const HEADER_H = 90;
const CARD_H = HEADER_H + QR_PX + PADDING * 2;

// Smiley hole — 32 % of QR side. Level H budget allows up to ~30 %
// of MODULES corrupted; our hole skips roughly that fraction at this
// size but only of *data* modules (finder/timing/alignment stay
// intact), so the actual recovery load is well under the budget.
const smileyD = Math.round(QR_PX * 0.32);
const smileyX = PADDING + (QR_PX - smileyD) / 2;
const smileyY = HEADER_H + PADDING + (QR_PX - smileyD) / 2;
const smileyHalfModules = Math.ceil(smileyD / (2 * MODULE)) + 1;
const centerModule = (SIZE - 1) / 2;
function inSmileyHole(r, c) {
  return (
    Math.abs(r - centerModule) <= smileyHalfModules &&
    Math.abs(c - centerModule) <= smileyHalfModules
  );
}

const cloverSymbol = `
  <symbol id="clover" viewBox="0 0 100 100">
    <g fill="#4d9748">
      <ellipse cx="35" cy="35" rx="18" ry="22" transform="rotate(-45 35 35)"/>
      <ellipse cx="65" cy="35" rx="18" ry="22" transform="rotate(45 65 35)"/>
      <ellipse cx="35" cy="65" rx="18" ry="22" transform="rotate(45 35 65)"/>
      <ellipse cx="65" cy="65" rx="18" ry="22" transform="rotate(-45 65 65)"/>
    </g>
  </symbol>
`;

const structuralSquares = [];
const cloverUses = [];
for (let r = 0; r < SIZE; r++) {
  for (let c = 0; c < SIZE; c++) {
    if (!isDark(r, c)) continue;
    const x = PADDING + c * MODULE;
    const y = HEADER_H + PADDING + r * MODULE;
    if (isStructural(r, c)) {
      structuralSquares.push(
        `<rect x="${x}" y="${y}" width="${MODULE}" height="${MODULE}" fill="#2f6230"/>`,
      );
    } else if (!inSmileyHole(r, c)) {
      cloverUses.push(
        `<use href="#clover" x="${x}" y="${y}" width="${MODULE}" height="${MODULE}"/>`,
      );
    }
    // (smiley hole: data modules omitted, structural ones still drawn —
    //  none should fall inside in practice, our center is far from any
    //  finder/alignment.)
  }
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${CARD_W} ${CARD_H}"
     width="${CARD_W}" height="${CARD_H}"
     font-family="Inter, system-ui, sans-serif">
  <defs>
    ${cloverSymbol}
  </defs>

  <!-- Card background -->
  <rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="#ffffff"/>

  <!-- #${findId} header -->
  <text x="${CARD_W / 2}" y="${HEADER_H / 2 + 18}"
        text-anchor="middle"
        font-size="56"
        font-weight="700"
        fill="#111827"
        letter-spacing="-1">#${findId}</text>

  <!-- Structural QR modules (finder/timing/alignment/dark) -->
  ${structuralSquares.join("\n  ")}

  <!-- Data modules rendered as clovers -->
  ${cloverUses.join("\n  ")}

  <!-- Center smiley — empty hole, no backdrop -->
  <image href="data:image/png;base64,${safronusB64}"
         x="${smileyX}" y="${smileyY}"
         width="${smileyD}" height="${smileyD}"/>
</svg>
`;

const outPath = resolve(__dirname, `qr-real-${findId}.svg`);
writeFileSync(outPath, svg);
console.log(
  `Wrote ${outPath} — QR v${VERSION}, ${SIZE}×${SIZE} modules, ${structuralSquares.length} structural + ${cloverUses.length} clover modules, ${(svg.length / 1024).toFixed(1)} kB`,
);
console.log(`URL encoded: ${url}`);
console.log(`Open with: open "${outPath}"`);
