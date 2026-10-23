import { describe, expect, it } from "vitest";
import { renderQrSvg } from "@/lib/admin/qr";
import { renderCasqbQrSvg, CASQB_DEFAULT_STYLE } from "@/lib/admin/casqbQr";
import { stripBackgroundRect } from "./qr-download";

/**
 * The transparent-PNG option rests entirely on one assumption: the only
 * `<rect>` at the SVG origin is the background every renderer paints
 * first. These tests pin that assumption against the REAL output of both
 * renderers, so a future change to either one's background shape (or a new
 * rect that happens to sit at 0,0) fails here instead of silently handing
 * the admin a half-stripped PNG.
 */

/** The background rect as the renderers actually emit it. */
const originRect = (svg: string) => svg.match(/<rect x="0" y="0"[^>]*\/>/);
const rectCount = (svg: string) => (svg.match(/<rect /g) ?? []).length;

describe("stripBackgroundRect — site QR (qr.ts)", () => {
  it("drops exactly the origin background and nothing else", () => {
    const svg = renderQrSvg({ url: "https://ctyrlistkoteka.cz" });
    const bg = originRect(svg);
    expect(bg).not.toBeNull();

    const stripped = stripBackgroundRect(svg);
    // Removing the first origin rect by hand must equal the helper's work.
    expect(stripped).toBe(svg.replace(bg![0], ""));
    expect(originRect(stripped)).toBeNull();
    // One rect fewer, i.e. only the background went.
    expect(rectCount(stripped)).toBe(rectCount(svg) - 1);
    // The code itself survives: clover modules + the <svg> box stay.
    expect(stripped).toContain('<use href="#ctyr-qr-clover"');
    expect(stripped).toMatch(/<svg[^>]*\swidth="\d+"/);
  });

  it("keeps the panel border — that rect is inset, not at the origin", () => {
    const svg = renderQrSvg({ url: "https://ctyrlistkoteka.cz", border: "panel" });
    const stripped = stripBackgroundRect(svg);
    // Brand panel fill survives; only the full-canvas background is gone.
    expect(stripped).toContain("#e3f2e8");
    expect(rectCount(stripped)).toBe(rectCount(svg) - 1);
  });

  it("strips the dark theme's background without touching the centre hole", () => {
    // Dark theme paints both the background AND the centre hole in #0c100e;
    // only the origin one may go.
    const svg = renderQrSvg({ url: "https://ctyrlistkoteka.cz", theme: "dark" });
    const stripped = stripBackgroundRect(svg);
    expect(originRect(stripped)).toBeNull();
    expect(rectCount(stripped)).toBe(rectCount(svg) - 1);
    // The hole rect (same colour, different position) is still there.
    expect(stripped).toContain("#0c100e");
  });
});

describe("stripBackgroundRect — CaSQB QR (casqbQr.ts)", () => {
  it("drops exactly the origin background and nothing else", () => {
    const svg = renderCasqbQrSvg({
      url: "https://casqb.org",
      style: CASQB_DEFAULT_STYLE,
      px: 512,
    });
    const bg = originRect(svg);
    expect(bg).not.toBeNull();

    const stripped = stripBackgroundRect(svg);
    expect(stripped).toBe(svg.replace(bg![0], ""));
    expect(originRect(stripped)).toBeNull();
    expect(rectCount(stripped)).toBe(rectCount(svg) - 1);
    // Finder eyes survive (the default eye style draws them).
    expect(stripped).toContain(CASQB_DEFAULT_STYLE.eyeInner);
    expect(stripped).toMatch(/<svg[^>]*\swidth="\d+"/);
  });
});

describe("stripBackgroundRect — edges", () => {
  it("leaves an SVG that has no origin rect untouched", () => {
    const svg = '<svg><rect x="5" y="5" width="1" height="1" fill="#000"/></svg>';
    expect(stripBackgroundRect(svg)).toBe(svg);
  });

  it("removes only the first origin rect", () => {
    const svg =
      '<svg><rect x="0" y="0" width="10" height="10" fill="#fff"/>' +
      '<rect x="0" y="0" width="10" height="10" fill="#eee"/></svg>';
    const stripped = stripBackgroundRect(svg);
    expect(stripped).toContain("#eee");
    expect(stripped).not.toContain("#fff");
  });
});
