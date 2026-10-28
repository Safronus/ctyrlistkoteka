import { describe, expect, it } from "vitest";
import { CONTINENT_KEYS } from "./continents";
import { EUROPE_SIDE_RING, renderContinentMapSvg } from "./continentMap";

/** Planar even-odd point-in-ring on [lng, lat] — the same plane the clip
 *  ring is interpolated in before projection. */
function onEuropeSide(lng: number, lat: number): boolean {
  let inside = false;
  const r = EUROPE_SIDE_RING;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!;
    const [xj, yj] = r[j]!;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

describe("Europe–Asia line", () => {
  it.each([
    ["Moscow", 37.62, 55.75],
    ["Samara", 50.1, 53.2],
    ["Arkhangelsk", 40.52, 64.54],
    ["Novaya Zemlya (Belushya Guba)", 52.53, 71.55],
    ["Grozny", 45.69, 43.32],
    ["Derbent", 48.29, 42.06],
    ["Istanbul, Fatih (European bank)", 28.95, 41.01],
    ["Edirne", 26.56, 41.68],
    ["Atyrau region west of the Ural river", 50.5, 47.5],
  ])("%s is on the Europe side", (_n, lng, lat) => {
    expect(onEuropeSide(lng, lat)).toBe(true);
  });

  it.each([
    ["Yekaterinburg", 60.6, 56.84],
    ["Chelyabinsk", 61.4, 55.16],
    ["Aktobe", 57.21, 50.28],
    ["Yamal peninsula", 70, 70],
    ["Tbilisi", 44.79, 41.72],
    ["Baku", 49.87, 40.41],
    ["Istanbul, Kadıköy (Asian bank)", 29.03, 40.99],
    ["Ankara", 32.85, 39.93],
    ["Çanakkale", 26.41, 40.15],
  ])("%s is on the Asia side", (_n, lng, lat) => {
    expect(onEuropeSide(lng, lat)).toBe(false);
  });
});

describe("renderContinentMapSvg", () => {
  const render = (continent: (typeof CONTINENT_KEYS)[number]) =>
    renderContinentMapSvg({
      continent,
      byCountry: [
        { code: "203", count: 100 }, // Czechia
        { code: "643", count: 5 }, // Russia
      ],
      label: (_id, name) => `<${name}>`,
      tooltip: (label, count) => `${label}: ${count}`,
      ariaLabel: "a & b",
    });

  it.each(CONTINENT_KEYS)("renders %s as one well-formed svg", (c) => {
    const svg = render(c);
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    // Ids must be unique on the page (all six can be loaded at once).
    const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id!.startsWith(`geo-${c}-`)).toBe(true);
  });

  it("escapes names and the aria label", () => {
    const svg = render("europe");
    expect(svg).toContain('aria-label="a &amp; b"');
    expect(svg).toContain("&lt;Czechia&gt;: 100");
    expect(svg).not.toContain("<Czechia>");
  });

  it("clips the split countries only on the Europe and Asia maps", () => {
    for (const c of CONTINENT_KEYS) {
      const svg = render(c);
      const split = c === "europe" || c === "asia";
      expect(svg.includes(`clip-path="url(#geo-${c}-side)"`)).toBe(split);
    }
    // Russia is coloured (a member) on both, via the referenced shape.
    expect(render("europe")).toMatch(/<use href="#geo-europe-t\d+" fill="oklch\(0\.[0-9.]+ [0-9.]+ 145\)"/);
    expect(render("asia")).toMatch(/<use href="#geo-asia-t\d+" fill="oklch\(0\.[0-9.]+ [0-9.]+ 145\)"/);
  });

  // Deterministic on purpose: an earlier version also asserted the second
  // render took < 50 ms, and a wall-clock threshold flakes when another
  // build or test run shares the machine.
  it("renders identically from the cached geometry", () => {
    expect(render("asia")).toBe(render("asia"));
  });
});
