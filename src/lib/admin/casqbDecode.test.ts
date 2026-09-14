import { describe, expect, it } from "vitest";
import { CASQB_DEFAULT_STYLE, moduleCountFor, renderCasqbQrSvg, type CasqbStyle } from "./casqbQr";
import { casqbDecodeCheck } from "./casqbDecode";
import { CASQB_QUALITY_BLUE, CASQB_QUALITY_RED } from "./casqbBrand";

const URL = "https://ctyrlistkoteka.cz/go/cq7k2m";
const check = (style: CasqbStyle) =>
  casqbDecodeCheck(renderCasqbQrSvg({ url: URL, style, px: 400 }), URL, moduleCountFor(URL));

describe("casqbDecodeCheck", () => {
  it("passes the default at every size", async () => {
    const r = await check(CASQB_DEFAULT_STYLE);
    expect(r.verdict).toBe("ok");
    expect(r.sizes).toHaveLength(4);
  });

  it("calls the red-pupil-on-light-blue case risky, not failed", async () => {
    const r = await check({
      ...CASQB_DEFAULT_STYLE,
      modules: "dot",
      fg: "#151C1F",
      eyeOuter: "#151C1F",
      eyeInner: CASQB_QUALITY_RED,
      bg: CASQB_QUALITY_BLUE,
    });
    expect(r.verdict).toBe("risky");
    expect(r.sizes.some((s) => s.ok)).toBe(true);
  });

  it("fails a pupil no decoder can see", async () => {
    const r = await check({
      ...CASQB_DEFAULT_STYLE,
      modules: "square",
      eyeInner: "#c4c4c4",
      eyeOuter: "#151C1F",
      fg: "#151C1F",
      bg: "#FFFFFF",
    });
    expect(r.verdict).toBe("fail");
  });
});
