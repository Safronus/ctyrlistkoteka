import { describe, expect, it } from "vitest";
import {
  CONTINENT_FRAME,
  CONTINENT_KEYS,
  isContinentKey,
  isContinentMember,
  isTranscontinental,
  type ContinentKey,
} from "./continents";
import { getWorldCountriesHiRes } from "./world-countries-hires";

const features = getWorldCountriesHiRes().features;

function byName(name: string) {
  const f = features.find((x) => x.properties.name === name);
  if (!f) throw new Error(`${name} not in dataset`);
  return f.properties;
}
const member = (c: ContinentKey, name: string) => {
  const p = byName(name);
  return isContinentMember(c, p.id, p.name);
};

describe("continent membership (50m dataset)", () => {
  it("assigns every country to a continent, bar Antarctica and three remote territories", () => {
    const unassigned = features
      .filter((f) => !CONTINENT_KEYS.some((c) => isContinentMember(c, f.properties.id, f.properties.name)))
      .map((f) => f.properties.name)
      .sort();
    expect(unassigned).toEqual([
      "Antarctica",
      "Br. Indian Ocean Ter.",
      "Fr. S. Antarctic Lands",
      "Heard I. and McDonald Is.",
    ]);
  });

  it("puts exactly the five split countries in two continents", () => {
    const multi = features
      .filter((f) => CONTINENT_KEYS.filter((c) => isContinentMember(c, f.properties.id, f.properties.name)).length > 1)
      .map((f) => f.properties.name)
      .sort();
    expect(multi).toEqual(["Azerbaijan", "Georgia", "Kazakhstan", "Russia", "Turkey"]);
    for (const name of multi) expect(isTranscontinental(byName(name).id)).toBe(true);
  });

  it("resolves the historical-code countries (FX, SU, YU, UK, HV, DY)", () => {
    expect(member("europe", "France")).toBe(true);
    expect(member("europe", "Serbia")).toBe(true);
    expect(member("europe", "United Kingdom")).toBe(true);
    expect(member("africa", "Burkina Faso")).toBe(true);
    expect(member("africa", "Benin")).toBe(true);
  });

  it("joins the code-less features by name", () => {
    expect(member("europe", "Kosovo")).toBe(true);
    expect(member("europe", "N. Cyprus")).toBe(true);
    expect(member("africa", "Somaliland")).toBe(true);
    expect(member("asia", "Siachen Glacier")).toBe(true);
  });

  it("keeps the deliberate one-continent calls", () => {
    expect(member("europe", "Cyprus")).toBe(true);
    expect(member("asia", "Cyprus")).toBe(false);
    expect(member("asia", "Armenia")).toBe(true);
    expect(member("europe", "Armenia")).toBe(false);
    expect(member("africa", "Egypt")).toBe(true);
    expect(member("asia", "Egypt")).toBe(false);
    expect(member("northAmerica", "Greenland")).toBe(true);
    expect(member("europe", "Greenland")).toBe(false);
  });

  it("places the new continents' anchors", () => {
    expect(member("northAmerica", "Canada")).toBe(true);
    expect(member("northAmerica", "Mexico")).toBe(true);
    expect(member("southAmerica", "Brazil")).toBe(true);
    expect(member("southAmerica", "Falkland Is.")).toBe(true);
    expect(member("oceania", "Australia")).toBe(true);
    expect(member("oceania", "New Zealand")).toBe(true);
    expect(member("oceania", "Fiji")).toBe(true);
  });
});

describe("continent keys + frames", () => {
  it("validates keys", () => {
    expect(isContinentKey("europe")).toBe(true);
    expect(isContinentKey("atlantis")).toBe(false);
  });

  it("has a frame for every continent", () => {
    for (const c of CONTINENT_KEYS) {
      const f = CONTINENT_FRAME[c];
      expect(f.width).toBeGreaterThan(0);
      expect(f.height).toBeGreaterThan(0);
      expect(f.bounds[0][0]).toBeLessThan(f.bounds[1][0]);
      expect(f.bounds[0][1]).toBeLessThan(f.bounds[1][1]);
    }
  });
});
