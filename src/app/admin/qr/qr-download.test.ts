import { describe, expect, it } from "vitest";
import { renderQrSvg } from "@/lib/admin/qr";
import { renderCasqbQrSvg, CASQB_DEFAULT_STYLE } from "@/lib/admin/casqbQr";
import { stripBackgroundFills } from "./qr-download";

/**
 * The transparent-PNG option rests on one contract: every solid fill that
 * is "background" — the full canvas AND the pad behind the centre image or
 * logo — carries `data-qr-bg="1"`, and nothing else does. These tests pin
 * that against the REAL output of both renderers, so a renderer change
 * that adds an unmarked background (the 2026-10-28 bug: a white square
 * left under the clover) or marks a data module fails here instead of
 * handing the admin a half-transparent or broken PNG.
 */

const marked = (svg: string) => svg.match(/<rect\b[^>]*\sdata-qr-bg="1"[^>]*\/>/g) ?? [];
const originRect = (svg: string) => svg.match(/<rect x="0" y="0"[^>]*\/>/);
const rectCount = (svg: string) => (svg.match(/<rect /g) ?? []).length;
const useCount = (svg: string) => (svg.match(/<use /g) ?? []).length;

describe("stripBackgroundFills — site / find QR (qr.ts)", () => {
  it("drops the canvas background AND the pad under the centre image", () => {
    // Default centre = clover image in a padded hole.
    const svg = renderQrSvg({ url: "https://ctyrlistkoteka.cz" });
    expect(svg).toContain("<image ");
    expect(marked(svg)).toHaveLength(2);

    const stripped = stripBackgroundFills(svg);
    expect(marked(stripped)).toHaveLength(0);
    expect(originRect(stripped)).toBeNull();
    expect(rectCount(stripped)).toBe(rectCount(svg) - 2);
    // The code itself survives: every clover module, the centre image and
    // the <svg> box stay.
    expect(useCount(stripped)).toBe(useCount(svg));
    expect(stripped).toContain("<image ");
    expect(stripped).toMatch(/<svg[^>]*\swidth="\d+"/);
  });

  it("strips only the canvas background when there is no centre image", () => {
    const svg = renderQrSvg({ url: "https://ctyrlistkoteka.cz", center: "none" });
    expect(marked(svg)).toHaveLength(1);
    const stripped = stripBackgroundFills(svg);
    expect(rectCount(stripped)).toBe(rectCount(svg) - 1);
  });

  it("keeps the panel border — the panel is not a background fill", () => {
    const svg = renderQrSvg({ url: "https://ctyrlistkoteka.cz", border: "panel" });
    const stripped = stripBackgroundFills(svg);
    // The panel rect (fill + stroke) stays; the centre pad, which was
    // panel-tinted, goes — the panel under it shows the same colour.
    expect(stripped).toMatch(/<rect [^>]*fill="#e3f2e8" stroke="#b7dcc4"/);
    expect(rectCount(stripped)).toBe(rectCount(svg) - 2);
  });

  it("strips the dark theme's background and centre pad alike", () => {
    // Dark theme paints both in #0c100e; transparent means both go.
    const svg = renderQrSvg({ url: "https://ctyrlistkoteka.cz", theme: "dark" });
    const stripped = stripBackgroundFills(svg);
    expect(stripped).not.toContain('fill="#0c100e"');
    expect(rectCount(stripped)).toBe(rectCount(svg) - 2);
  });

  it("never marks a data module — square modules all survive", () => {
    const svg = renderQrSvg({ url: "https://ctyrlistkoteka.cz", moduleStyle: "square" });
    const stripped = stripBackgroundFills(svg);
    expect(rectCount(stripped)).toBe(rectCount(svg) - marked(svg).length);
    expect(marked(svg)).toHaveLength(2);
  });
});

describe("stripBackgroundFills — CaSQB QR (casqbQr.ts)", () => {
  it("drops the canvas background and the logo pad, keeps the logo and eyes", () => {
    const svg = renderCasqbQrSvg({
      url: "https://casqb.org",
      style: CASQB_DEFAULT_STYLE,
      px: 512,
    });
    const pads = marked(svg).length;
    // Background always; plus the logo pad when the default style has a logo.
    expect(pads).toBe(CASQB_DEFAULT_STYLE.logo === "none" ? 1 : 2);

    const stripped = stripBackgroundFills(svg);
    expect(marked(stripped)).toHaveLength(0);
    expect(originRect(stripped)).toBeNull();
    expect(rectCount(stripped)).toBe(rectCount(svg) - pads);
    // Finder eyes survive (the default eye style draws them).
    expect(stripped).toContain(CASQB_DEFAULT_STYLE.eyeInner);
    expect(stripped).toMatch(/<svg[^>]*\swidth="\d+"/);
  });
});

describe("stripBackgroundFills — edges", () => {
  it("leaves an SVG without marked fills untouched", () => {
    const svg = '<svg><rect x="0" y="0" width="1" height="1" fill="#000"/></svg>';
    expect(stripBackgroundFills(svg)).toBe(svg);
  });

  it("removes every marked rect, wherever it sits", () => {
    const svg =
      '<svg><rect x="0" y="0" width="10" height="10" fill="#fff" data-qr-bg="1"/>' +
      '<rect x="3" y="3" width="4" height="4" rx="1" fill="#fff" data-qr-bg="1"/>' +
      '<rect x="1" y="1" width="1" height="1" fill="#111"/></svg>';
    const stripped = stripBackgroundFills(svg);
    expect(stripped).not.toContain("#fff");
    expect(stripped).toContain("#111");
  });
});
