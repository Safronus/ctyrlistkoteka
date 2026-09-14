import jsQR from "jsqr";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CASQB_DEFAULT_STYLE,
  CASQB_EYE_SHAPES,
  CASQB_MODULE_SHAPES,
  CASQB_PRESETS,
  casqbLogoBox,
  casqbLogoFill,
  casqbLogoHeightMm,
  casqbStyleBlockers,
  casqbStyleWarnings,
  contrastRatio,
  moduleCountFor,
  parseCasqbStyle,
  renderCasqbQrSvg,
  type CasqbStyle,
} from "./casqbQr";
import { CASQB_QUALITY_BLUE, CASQB_QUALITY_RED, CASQB_WHITE } from "./casqbBrand";

const URL = "https://ctyrlistkoteka.cz/go/cq7k2m";

/**
 * The only test that matters for a decorated QR: does a decoder read it.
 * Rasterised through sharp at a modest size — a phone sees the printed
 * code at a few pixels per module, not the crisp vector.
 */
async function decode(svg: string, px = 260): Promise<string | null> {
  const { data, info } = await sharp(Buffer.from(svg))
    .resize(px, px)
    .flatten({ background: "#ffffff" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const r = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
  return r?.data ?? null;
}

describe("renderCasqbQrSvg", () => {
  it("every preset decodes to the encoded URL", async () => {
    for (const p of CASQB_PRESETS) {
      const svg = renderCasqbQrSvg({ url: URL, style: p.style, px: 400 });
      expect(await decode(svg), p.label).toBe(URL);
    }
  });

  it("every module and eye shape decodes, large and at three pixels per module", async () => {
    // Both regimes matter: a fixed-block binariser trips on sparse ink
    // when the render is large, a phone trips on detail when it is small.
    const tiny = (moduleCountFor(URL) + 8) * 3;
    for (const modules of CASQB_MODULE_SHAPES) {
      for (const eyes of CASQB_EYE_SHAPES) {
        const style: CasqbStyle = { ...CASQB_DEFAULT_STYLE, modules, eyes };
        const svg = renderCasqbQrSvg({ url: URL, style, px: 400 });
        expect(await decode(svg, 400), `${modules}/${eyes} @400`).toBe(URL);
        expect(await decode(svg, tiny), `${modules}/${eyes} @${tiny}`).toBe(URL);
      }
    }
  });

  it("still decodes small — three pixels per module", async () => {
    const svg = renderCasqbQrSvg({ url: URL, style: CASQB_DEFAULT_STYLE, px: 400 });
    const n = moduleCountFor(URL);
    expect(await decode(svg, (n + 8) * 3)).toBe(URL);
  });

  it("decodes with the wordmark and with no logo at all", async () => {
    for (const logo of ["wordmark", "none"] as const) {
      const svg = renderCasqbQrSvg({ url: URL, style: { ...CASQB_DEFAULT_STYLE, logo }, px: 400 });
      expect(await decode(svg), logo).toBe(URL);
    }
  });

  it("embeds the official geometry verbatim and only the official fills", () => {
    const red = renderCasqbQrSvg({ url: URL, style: CASQB_DEFAULT_STYLE, px: 300 });
    expect(red).toContain(`fill="${CASQB_QUALITY_RED}"><path d="M52.659,181.413`);
    const onDark = renderCasqbQrSvg({
      url: URL,
      style: { ...CASQB_DEFAULT_STYLE, fg: CASQB_WHITE, eyeOuter: CASQB_WHITE, eyeInner: CASQB_WHITE, bg: "#27383F" },
      px: 300,
    });
    expect(onDark).toContain(`fill="${CASQB_WHITE}"><path d="M52.659,181.413`);
  });
});

describe("casqbLogoBox", () => {
  it("keeps the hole under a sixth of the matrix for every logo", () => {
    const n = moduleCountFor(URL);
    for (const logo of ["symbol", "wordmark"] as const) {
      for (const logoScale of ["sm", "md"] as const) {
        const box = casqbLogoBox({ ...CASQB_DEFAULT_STYLE, logo, logoScale }, n);
        expect(box).not.toBeNull();
        expect((box!.holeW * box!.holeH) / (n * n)).toBeLessThanOrEqual(0.16);
      }
    }
  });

  it("applies the manual's protection zone — 25 % for the symbol, 40 % for the wordmark", () => {
    const n = 37;
    const sym = casqbLogoBox({ ...CASQB_DEFAULT_STYLE, logo: "symbol" }, n)!;
    expect(sym.holeH).toBeCloseTo(sym.h * 1.5, 6);
    expect(sym.holeW).toBeCloseTo(sym.w + 0.5 * sym.h, 6);
    const word = casqbLogoBox({ ...CASQB_DEFAULT_STYLE, logo: "wordmark" }, n)!;
    expect(word.holeH).toBeCloseTo(word.h * 1.8, 6);
    expect(word.holeW).toBeCloseTo(word.w + 0.8 * word.h, 6);
  });

  it("has no box without a logo", () => {
    expect(casqbLogoBox({ ...CASQB_DEFAULT_STYLE, logo: "none" }, 37)).toBeNull();
  });
});

describe("colour rules", () => {
  it("chooses the red logo on light grounds and the white one on dark", () => {
    expect(casqbLogoFill(CASQB_WHITE)).toBe(CASQB_QUALITY_RED);
    expect(casqbLogoFill("#DFF3FD")).toBe(CASQB_QUALITY_RED);
    expect(casqbLogoFill(CASQB_QUALITY_RED)).toBe(CASQB_WHITE);
    expect(casqbLogoFill("#27383F")).toBe(CASQB_WHITE);
  });

  it("the brand red on white clears the scanner floor, Quality Blue does not", () => {
    expect(contrastRatio(CASQB_QUALITY_RED, CASQB_WHITE)).toBeGreaterThan(3.7);
    expect(contrastRatio(CASQB_QUALITY_BLUE, CASQB_WHITE)).toBeLessThan(1.6);
  });

  it("blocks an unreadable pair and a custom logo without an image", () => {
    expect(casqbStyleBlockers(CASQB_DEFAULT_STYLE)).toEqual([]);
    expect(casqbStyleBlockers({ ...CASQB_DEFAULT_STYLE, fg: CASQB_QUALITY_BLUE })).toHaveLength(1);
    expect(casqbStyleBlockers({ ...CASQB_DEFAULT_STYLE, logo: "custom" })).toHaveLength(1);
  });

  it("only warns about a low-contrast pupil or logo — the owner's blue-and-red case", () => {
    const blueRed: CasqbStyle = {
      ...CASQB_DEFAULT_STYLE,
      modules: "dot",
      fg: "#151C1F",
      eyeOuter: "#151C1F",
      eyeInner: CASQB_QUALITY_RED,
      bg: CASQB_QUALITY_BLUE,
    };
    expect(casqbStyleBlockers(blueRed)).toEqual([]);
    expect(casqbStyleWarnings(blueRed).join(" ")).toMatch(/Zornice/);
    // A mid-tone ground defeats both official logo variants — visually only.
    expect(casqbStyleWarnings({ ...CASQB_DEFAULT_STYLE, fg: CASQB_WHITE, eyeOuter: CASQB_WHITE, eyeInner: CASQB_WHITE, bg: "#76A5BB" }).join(" ")).toMatch(/Logo/);
    expect(casqbStyleWarnings(CASQB_DEFAULT_STYLE)).toEqual([]);
  });
});

describe("parseCasqbStyle", () => {
  it("accepts the default and rejects a tampered colour", () => {
    expect(parseCasqbStyle(CASQB_DEFAULT_STYLE)).toEqual(CASQB_DEFAULT_STYLE);
    expect(parseCasqbStyle({ ...CASQB_DEFAULT_STYLE, fg: "red" })).toBeNull();
    expect(parseCasqbStyle(null)).toBeNull();
  });
});

describe("casqbLogoHeightMm", () => {
  it("the symbol clears 5 mm at 40 mm, the wordmark does not", () => {
    expect(casqbLogoHeightMm(CASQB_DEFAULT_STYLE, URL, 40)!).toBeGreaterThan(5);
    expect(casqbLogoHeightMm({ ...CASQB_DEFAULT_STYLE, logo: "wordmark" }, URL, 40)!).toBeLessThan(5);
    expect(casqbLogoHeightMm({ ...CASQB_DEFAULT_STYLE, logo: "none" }, URL, 40)).toBeNull();
  });
});
