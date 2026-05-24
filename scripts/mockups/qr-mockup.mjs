#!/usr/bin/env node
// QR-style mockup generator for the admin "QR for find" feature.
// Output: scripts/mockups/qr-preview.svg — open in browser/Preview.
// This is NOT a real scannable QR — it's a visual sketch with
// realistic-looking pattern (locators, timing, alignment, data
// modules), so we can iterate on the LOOK before wiring up the
// real qrcode library. Once we agree on the design, the production
// implementation will swap the fake matrix for a real QR encoder
// output and re-use the same rendering path.

import { writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const safronusPath = resolve(repoRoot, "public", "safronus.png");
const safronusB64 = readFileSync(safronusPath).toString("base64");

// ---------- QR matrix mockup ----------
// Version 4 QR is 33x33 modules. Realistic enough to test layout.
const SIZE = 33;
const matrix = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));

// Place a 7x7 finder pattern at (r,c). Outer ring + 3x3 center block.
function placeFinder(r, c) {
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      const onOuter = i === 0 || i === 6 || j === 0 || j === 6;
      const onInner = i >= 2 && i <= 4 && j >= 2 && j <= 4;
      matrix[r + i][c + j] = onOuter || onInner ? 1 : 0;
    }
  }
}
placeFinder(0, 0);
placeFinder(0, SIZE - 7);
placeFinder(SIZE - 7, 0);

// 5x5 alignment pattern (single one for v4 at center-ish)
function placeAlignment(r, c) {
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const onOuter = i === 0 || i === 4 || j === 0 || j === 4;
      const onCenter = i === 2 && j === 2;
      matrix[r + i][c + j] = onOuter || onCenter ? 1 : 0;
    }
  }
}
placeAlignment(SIZE - 9, SIZE - 9);

// Timing patterns — alternating modules on row 6 and col 6 between finders
for (let i = 8; i < SIZE - 8; i++) {
  matrix[6][i] = i % 2 === 0 ? 1 : 0;
  matrix[i][6] = i % 2 === 0 ? 1 : 0;
}

// Fill data area with a deterministic-pseudorandom pattern so the
// mockup looks like a real QR (variable density, no obvious stripes).
// Seeded LCG keeps the SVG diffable across regeneration.
let seed = 20260524;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
for (let r = 0; r < SIZE; r++) {
  for (let c = 0; c < SIZE; c++) {
    // Skip reserved areas (finders + their separators)
    const inTL = r < 8 && c < 8;
    const inTR = r < 8 && c >= SIZE - 8;
    const inBL = r >= SIZE - 8 && c < 8;
    const inAlign =
      r >= SIZE - 9 && r <= SIZE - 5 && c >= SIZE - 9 && c <= SIZE - 5;
    const onTiming = r === 6 || c === 6;
    if (inTL || inTR || inBL || inAlign || onTiming) continue;
    matrix[r][c] = rand() < 0.48 ? 1 : 0;
  }
}

// ---------- SVG generation ----------
const MODULE = 18; // px per module — final QR ~594px (good for screen + print)
const PADDING = 20; // white quiet zone around QR
const QR_PX = SIZE * MODULE;
const CARD_W = QR_PX + PADDING * 2;
const HEADER_H = 90; // for #15900 title
const CARD_H = HEADER_H + QR_PX + PADDING * 2;

// Clover symbol — geometry from public/favicon.svg, stripped of the
// stem (too small to render cleanly at module size), centered in a
// 100x100 viewBox so the <use> tag scales straightforwardly.
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

// Center smiley sits in a TRULY empty square — we skip rendering the
// modules underneath instead of overlaying a white disc. A real QR
// uses error correction to recover the missing modules; here we just
// blank that area. ~18% side keeps us inside level-H budget (~30%).
const smileyD = Math.round(QR_PX * 0.18);
const smileyX = PADDING + (QR_PX - smileyD) / 2;
const smileyY = HEADER_H + PADDING + (QR_PX - smileyD) / 2;
// Translate the smiley box into module-grid coordinates so we know
// which (r,c) to skip. Slight pad (+1 module on each side) keeps
// the clover field from touching the smiley pixels.
const smileyHalfModules = Math.ceil(smileyD / (2 * MODULE)) + 1;
const centerModule = (SIZE - 1) / 2;
function inSmileyHole(r, c) {
  return (
    Math.abs(r - centerModule) <= smileyHalfModules &&
    Math.abs(c - centerModule) <= smileyHalfModules
  );
}

// Render every dark module as a clover, except in the smiley hole.
const cloverUses = [];
for (let r = 0; r < SIZE; r++) {
  for (let c = 0; c < SIZE; c++) {
    if (matrix[r][c] !== 1) continue;
    if (inSmileyHole(r, c)) continue;
    const x = PADDING + c * MODULE;
    const y = HEADER_H + PADDING + r * MODULE;
    cloverUses.push(
      `<use href="#clover" x="${x}" y="${y}" width="${MODULE}" height="${MODULE}"/>`,
    );
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

  <!-- #15900 header -->
  <text x="${CARD_W / 2}" y="${HEADER_H / 2 + 18}"
        text-anchor="middle"
        font-size="56"
        font-weight="700"
        fill="#111827"
        letter-spacing="-1">#15900</text>

  <!-- QR area background (white quiet zone) -->
  <rect x="${PADDING / 2}" y="${HEADER_H + PADDING / 2}"
        width="${QR_PX + PADDING}" height="${QR_PX + PADDING}"
        fill="#ffffff"/>

  <!-- Clover dots (skipped in center smiley hole) -->
  ${cloverUses.join("\n  ")}

  <!-- Center smiley — placed directly on the empty hole, no backdrop -->
  <image href="data:image/png;base64,${safronusB64}"
         x="${smileyX}" y="${smileyY}"
         width="${smileyD}" height="${smileyD}"/>
</svg>
`;

const outPath = resolve(__dirname, "qr-preview.svg");
writeFileSync(outPath, svg);
console.log(`Wrote ${outPath} (${(svg.length / 1024).toFixed(1)} kB)`);
console.log(`Open with: open "${outPath}"`);
