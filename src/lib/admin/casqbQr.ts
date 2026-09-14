import QRCode from "qrcode";
import { z } from "zod";
import {
  CASQB_BLUE_SCALE,
  CASQB_QUALITY_BLUE,
  CASQB_QUALITY_RED,
  CASQB_RED_SCALE,
  CASQB_SYMBOL,
  CASQB_WHITE,
  CASQB_WORDMARK,
  type CasqbVector,
} from "./casqbBrand";

/**
 * CaSQB QR codes — a real QR matrix dressed by the brand manual.
 *
 * Kept apart from `qr.ts` (the site's own codes) on purpose: that renderer
 * is built around the site's themes and the clover; this one is built
 * around someone else's brand rules, and the two must be free to diverge.
 * What they share is only the `qrcode` matrix underneath.
 *
 * Everything decorative here is a lie a scanner has to see through, so
 * three things are not negotiable: error correction stays at H (30 %), the
 * centre hole is sized from the manual's protection zone and capped at a
 * share of the matrix, and a colour pair a scanner can't separate (below
 * 3 : 1) is refused before it is ever saved.
 */

export const CASQB_MODULE_SHAPES = ["square", "rounded", "dot", "fluid"] as const;
export const CASQB_EYE_SHAPES = ["square", "rounded", "circle"] as const;
export const CASQB_LOGO_KINDS = ["symbol", "wordmark", "custom", "none"] as const;
export const CASQB_LOGO_SCALES = ["sm", "md"] as const;

export type CasqbModuleShape = (typeof CASQB_MODULE_SHAPES)[number];
export type CasqbEyeShape = (typeof CASQB_EYE_SHAPES)[number];
export type CasqbLogoKind = (typeof CASQB_LOGO_KINDS)[number];
export type CasqbLogoScale = (typeof CASQB_LOGO_SCALES)[number];

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** A custom centre image. Always PNG: an uploaded SVG is rasterised on
 *  the server (sharp) before it gets here, so nothing script-shaped ever
 *  lands inside a downloadable SVG. Base64, capped so a code's row stays
 *  small. */
export const CasqbCustomLogoSchema = z.object({
  data: z.string().min(1).max(280_000),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const CasqbStyleSchema = z.object({
  modules: z.enum(CASQB_MODULE_SHAPES),
  eyes: z.enum(CASQB_EYE_SHAPES),
  fg: z.string().regex(HEX),
  eyeOuter: z.string().regex(HEX),
  eyeInner: z.string().regex(HEX),
  bg: z.string().regex(HEX),
  logo: z.enum(CASQB_LOGO_KINDS),
  logoScale: z.enum(CASQB_LOGO_SCALES),
  custom: CasqbCustomLogoSchema.optional(),
});
export type CasqbStyle = z.infer<typeof CasqbStyleSchema>;
export type CasqbCustomLogo = z.infer<typeof CasqbCustomLogoSchema>;

/** Direction A of the design round — the brand's own red, rounded. */
export const CASQB_DEFAULT_STYLE: CasqbStyle = {
  modules: "rounded",
  eyes: "rounded",
  fg: CASQB_QUALITY_RED,
  eyeOuter: CASQB_RED_SCALE[70],
  eyeInner: CASQB_QUALITY_RED,
  bg: CASQB_WHITE,
  logo: "symbol",
  logoScale: "md",
};

export const CASQB_PRESETS: ReadonlyArray<{
  key: string;
  label: string;
  style: CasqbStyle;
}> = [
  { key: "brand", label: "Značka", style: CASQB_DEFAULT_STYLE },
  {
    key: "dark",
    label: "Tmavá",
    style: {
      ...CASQB_DEFAULT_STYLE,
      modules: "dot",
      fg: CASQB_BLUE_SCALE[90],
      eyeOuter: CASQB_BLUE_SCALE[90],
      eyeInner: CASQB_QUALITY_RED,
    },
  },
  {
    key: "fluid",
    label: "Plynulá",
    style: {
      ...CASQB_DEFAULT_STYLE,
      modules: "fluid",
      eyes: "circle",
      logo: "wordmark",
    },
  },
  {
    key: "inverse",
    label: "Inverzní",
    style: {
      ...CASQB_DEFAULT_STYLE,
      fg: CASQB_WHITE,
      eyeOuter: CASQB_WHITE,
      eyeInner: CASQB_WHITE,
      bg: CASQB_QUALITY_RED,
    },
  },
];

/** The manual's colours the form offers, with the roles each can play.
 *  Quality Blue is background-only: on white it reads 1.5 : 1, which no
 *  scanner separates. */
export const CASQB_SWATCHES: ReadonlyArray<{
  hex: string;
  name: string;
  roles: ReadonlyArray<"fg" | "eye" | "bg">;
}> = [
  { hex: CASQB_QUALITY_RED, name: "Quality Red", roles: ["fg", "eye", "bg"] },
  { hex: CASQB_RED_SCALE[70], name: "Red 70", roles: ["fg", "eye"] },
  { hex: CASQB_RED_SCALE[80], name: "Red 80", roles: ["fg", "eye"] },
  { hex: CASQB_BLUE_SCALE[90], name: "Blue 90", roles: ["fg", "eye", "bg"] },
  { hex: CASQB_BLUE_SCALE[100], name: "Blue 100", roles: ["fg", "eye", "bg"] },
  { hex: CASQB_BLUE_SCALE[70], name: "Blue 70", roles: ["fg", "eye"] },
  { hex: CASQB_WHITE, name: "Quality White", roles: ["fg", "eye", "bg"] },
  { hex: CASQB_BLUE_SCALE[10], name: "Blue 10", roles: ["bg"] },
  { hex: CASQB_RED_SCALE[10], name: "Red 10", roles: ["bg"] },
  { hex: CASQB_QUALITY_BLUE, name: "Quality Blue", roles: ["bg"] },
];

export function parseCasqbStyle(value: unknown): CasqbStyle | null {
  const r = CasqbStyleSchema.safeParse(value);
  return r.success ? r.data : null;
}

// ---------------------------------------------------------------- colour

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance — the quantity a scanner thresholds on. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** Below this a phone camera stops telling module from ground. The
 *  brand's own red on white sits at 3.75, so the floor is exactly what
 *  still lets the manual's palette through. */
export const CASQB_MIN_CONTRAST = 3;

/** Which official logo variant a ground calls for: the red one on a
 *  light ground, the white one on a dark one. Choosing between the two
 *  files the manual ships is not recolouring; anything else would be. */
export function casqbLogoFill(bg: string): string {
  return luminance(bg) >= 0.4 ? CASQB_QUALITY_RED : CASQB_WHITE;
}

/** Human-readable reasons a style must not be saved. Empty = fine. */
export function casqbStyleProblems(style: CasqbStyle): string[] {
  const out: string[] = [];
  const fmt = (n: number) => n.toFixed(1).replace(".", ",");
  const fg = contrastRatio(style.fg, style.bg);
  if (fg < CASQB_MIN_CONTRAST) {
    out.push(
      `Moduly a pozadí mají kontrast ${fmt(fg)} : 1 — čtečka potřebuje aspoň ${CASQB_MIN_CONTRAST} : 1.`,
    );
  }
  const eye = contrastRatio(style.eyeOuter, style.bg);
  if (eye < CASQB_MIN_CONTRAST) {
    out.push(`Oči a pozadí mají kontrast ${fmt(eye)} : 1 — pod ${CASQB_MIN_CONTRAST} : 1.`);
  }
  const inner = contrastRatio(style.eyeInner, style.bg);
  if (inner < CASQB_MIN_CONTRAST) {
    out.push(
      `Zornice očí a pozadí mají kontrast ${fmt(inner)} : 1 — pod ${CASQB_MIN_CONTRAST} : 1.`,
    );
  }
  if (style.logo === "custom" && !style.custom) {
    out.push("Vlastní logo je zvolené, ale žádný obrázek není nahraný.");
  }
  // The manual's red logo on a red ground would vanish; the fill rule
  // above flips to white there, but a mid-tone ground defeats both.
  if (style.logo === "symbol" || style.logo === "wordmark") {
    const c = contrastRatio(casqbLogoFill(style.bg), style.bg);
    if (c < CASQB_MIN_CONTRAST) {
      out.push(
        `Logo by na tomhle pozadí mělo kontrast jen ${fmt(c)} : 1 — zvol světlejší nebo tmavší pozadí.`,
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------- layout

/** Quiet zone in modules, the standard's four. */
const QUIET = 4;
/** Share of the matrix the centre hole may punch out. H recovers 30 %,
 *  the shaped modules already spend some of that, and a phone camera
 *  never sees a perfect frame — so well under. */
const MAX_HOLE_SHARE = 0.16;
/** Logo size as a share of the code's side, per scale. Symbol and custom
 *  go by height, the wide wordmark by width. */
const LOGO_SHARE: Record<CasqbLogoScale, { height: number; width: number }> = {
  sm: { height: 0.2, width: 0.34 },
  md: { height: 0.26, width: 0.42 },
};

interface LogoBox {
  /** Logo size in modules. */
  w: number;
  h: number;
  /** Hole (logo + protection zone) in modules. */
  holeW: number;
  holeH: number;
}

function vectorFor(style: CasqbStyle): CasqbVector | null {
  if (style.logo === "symbol") return CASQB_SYMBOL;
  if (style.logo === "wordmark") return CASQB_WORDMARK;
  return null;
}

/** Aspect and protection zone of whatever sits in the middle. A custom
 *  image follows the symbol's 25 % rule — the manual has no rule for it,
 *  and the tighter of the two official ones is the honest default. */
function logoGeometry(style: CasqbStyle): { aspect: number; zone: number } | null {
  const v = vectorFor(style);
  if (v) return { aspect: v.width / v.height, zone: v.protectionZone };
  if (style.logo === "custom" && style.custom) {
    return { aspect: style.custom.width / style.custom.height, zone: 0.25 };
  }
  return null;
}

/** Sizes the logo and its hole for a matrix of `n` modules, shrinking
 *  until the hole respects MAX_HOLE_SHARE. Exported for the tests and
 *  the print-size check. */
export function casqbLogoBox(style: CasqbStyle, n: number): LogoBox | null {
  const g = logoGeometry(style);
  if (!g) return null;
  const share = LOGO_SHARE[style.logoScale];
  const wide = g.aspect > 1.6;
  let h = wide ? (n * share.width) / g.aspect : n * share.height;
  for (let i = 0; i < 12; i++) {
    const w = h * g.aspect;
    const holeW = w + 2 * g.zone * h;
    const holeH = h + 2 * g.zone * h;
    if ((holeW * holeH) / (n * n) <= MAX_HOLE_SHARE) {
      return { w, h, holeW, holeH };
    }
    h *= 0.92;
  }
  return null;
}

export function moduleCountFor(url: string): number {
  return QRCode.create(url, { errorCorrectionLevel: "H" }).modules.size;
}

/**
 * Printed height of the logo when the whole code (quiet zone included)
 * is `codeWidthMm` wide, or null when there is no logo. The PDF export
 * holds this against the manual's 5 mm minimum.
 */
export function casqbLogoHeightMm(
  style: CasqbStyle,
  url: string,
  codeWidthMm: number,
): number | null {
  const n = moduleCountFor(url);
  const box = casqbLogoBox(style, n);
  if (!box) return null;
  return (box.h / (n + 2 * QUIET)) * codeWidthMm;
}

export function casqbLogoMinHeightMm(style: CasqbStyle): number {
  return vectorFor(style)?.minHeightMm ?? CASQB_SYMBOL.minHeightMm;
}

// ---------------------------------------------------------------- render

export interface RenderCasqbQrOpts {
  url: string;
  style: CasqbStyle;
  /** Rendered width/height in CSS px (the SVG scales losslessly). */
  px: number;
}

const f = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(3));

export function renderCasqbQrSvg(opts: RenderCasqbQrOpts): string {
  const { style } = opts;
  const qr = QRCode.create(opts.url, { errorCorrectionLevel: "H" });
  const n = qr.modules.size;
  const data = qr.modules.data;
  const total = n + 2 * QUIET;
  const mid = (n - 1) / 2;

  const dark = (r: number, c: number) =>
    r >= 0 && c >= 0 && r < n && c < n && data[r * n + c] === 1;
  const inEye = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

  const box = casqbLogoBox(style, n);
  const inHole = (r: number, c: number) =>
    box !== null &&
    Math.abs(r - mid) < box.holeH / 2 &&
    Math.abs(c - mid) < box.holeW / 2;
  const isData = (r: number, c: number) =>
    dark(r, c) && !inEye(r, c) && !inHole(r, c);

  const modules: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!isData(r, c)) continue;
      const x = c + QUIET;
      const y = r + QUIET;
      switch (style.modules) {
        case "square":
          modules.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
          break;
        case "rounded":
          modules.push(
            `<rect x="${f(x + 0.06)}" y="${f(y + 0.06)}" width="0.88" height="0.88" rx="0.26"/>`,
          );
          break;
        case "dot":
          // 0.46, not smaller: a decoder that thresholds in fixed blocks
          // (jsQR does) loses dots under ~0.45 on a LARGE render, where
          // the white between them outweighs the ink. Phones read 0.42
          // fine; the stricter decoder is the one the tests run.
          modules.push(
            `<circle cx="${f(x + 0.5)}" cy="${f(y + 0.5)}" r="0.46"/>`,
          );
          break;
        case "fluid":
          // A pill per module, plus a bridge to each dark neighbour to the
          // right and below, so runs read as one shape.
          modules.push(
            `<rect x="${f(x + 0.08)}" y="${f(y + 0.08)}" width="0.84" height="0.84" rx="0.42"/>`,
          );
          if (isData(r, c + 1)) {
            modules.push(
              `<rect x="${f(x + 0.5)}" y="${f(y + 0.08)}" width="1" height="0.84"/>`,
            );
          }
          if (isData(r + 1, c)) {
            modules.push(
              `<rect x="${f(x + 0.08)}" y="${f(y + 0.5)}" width="0.84" height="1"/>`,
            );
          }
          break;
      }
    }
  }

  const eye = (r0: number, c0: number): string => {
    const x = c0 + QUIET;
    const y = r0 + QUIET;
    switch (style.eyes) {
      case "square":
        return (
          `<path fill="${style.eyeOuter}" fill-rule="evenodd" d="M${x} ${y}h7v7h-7z M${x + 1} ${y + 1}v5h5v-5z"/>` +
          `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="${style.eyeInner}"/>`
        );
      case "rounded":
        return (
          `<rect x="${f(x + 0.5)}" y="${f(y + 0.5)}" width="6" height="6" rx="1.9" fill="none" stroke="${style.eyeOuter}" stroke-width="1"/>` +
          `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9" fill="${style.eyeInner}"/>`
        );
      case "circle":
        return (
          `<circle cx="${f(x + 3.5)}" cy="${f(y + 3.5)}" r="3" fill="none" stroke="${style.eyeOuter}" stroke-width="1"/>` +
          `<circle cx="${f(x + 3.5)}" cy="${f(y + 3.5)}" r="1.5" fill="${style.eyeInner}"/>`
        );
    }
  };

  let logo = "";
  if (box) {
    const cx = QUIET + mid + 0.5;
    const cy = QUIET + mid + 0.5;
    const hx = cx - box.holeW / 2;
    const hy = cy - box.holeH / 2;
    const rx = Math.min(box.holeW, box.holeH) * 0.18;
    logo += `<rect x="${f(hx)}" y="${f(hy)}" width="${f(box.holeW)}" height="${f(box.holeH)}" rx="${f(rx)}" fill="${style.bg}"/>`;
    const lx = cx - box.w / 2;
    const ly = cy - box.h / 2;
    const v = vectorFor(style);
    if (v) {
      const s = box.h / v.height;
      logo += `<g transform="translate(${f(lx)} ${f(ly)}) scale(${f(s)})" fill="${casqbLogoFill(style.bg)}">${v.paths.map((d) => `<path d="${d}"/>`).join("")}</g>`;
    } else if (style.custom) {
      logo += `<image href="data:image/png;base64,${style.custom.data}" x="${f(lx)}" y="${f(ly)}" width="${f(box.w)}" height="${f(box.h)}" preserveAspectRatio="xMidYMid meet"/>`;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${opts.px}" height="${opts.px}" shape-rendering="geometricPrecision" role="img" aria-label="QR kód CaSQB" data-qr-modules="${n}">` +
    `<rect x="0" y="0" width="${total}" height="${total}" fill="${style.bg}"/>` +
    `<g fill="${style.fg}">${modules.join("")}</g>` +
    eye(0, 0) +
    eye(0, n - 7) +
    eye(n - 7, 0) +
    logo +
    `</svg>`
  );
}
