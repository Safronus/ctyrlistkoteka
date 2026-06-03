import { describe, expect, it } from "vitest";
import { formatDensity } from "./format";

describe("formatDensity", () => {
  it("keeps small densities at the 100 m² reference area", () => {
    expect(formatDensity(12)).toBe("12 🍀/100 m²");
    expect(formatDensity(12.7)).toBe("13 🍀/100 m²");
    expect(formatDensity(99)).toBe("99 🍀/100 m²");
  });

  it("drops to 10 m² when per-100 m² would exceed two digits", () => {
    expect(formatDensity(150)).toBe("15 🍀/10 m²");
    // Boundary: 99.6 rounds to 100 at /100 m², so it steps down to /10 m².
    expect(formatDensity(99.6)).toBe("10 🍀/10 m²");
  });

  it("drops to 1 m² for very dense spots (e.g. the 5 m fallback circle)", () => {
    // 3000 finds in the ~78.5 m² fallback circle ≈ 3822 / 100 m².
    expect(formatDensity(3822)).toBe("38 🍀/m²");
  });

  it("shows <1 instead of a misleading 0 for sparse but non-empty spots", () => {
    expect(formatDensity(0.3)).toBe("<1 🍀/100 m²");
  });
});
