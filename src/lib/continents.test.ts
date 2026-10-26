import { describe, expect, it } from "vitest";
import { getContinentOutline, isContinentMember } from "./continents";
import { getWorldCountries } from "./world-countries";

/** Membership by the dataset's own (id, name) for a named country. */
function member(continent: "europe" | "asia" | "africa", name: string): boolean {
  const f = getWorldCountries().features.find((x) => x.properties.name === name);
  if (!f) throw new Error(`${name} not in dataset`);
  return isContinentMember(continent, f.properties.id, f.properties.name);
}

describe("isContinentMember", () => {
  it("places plain members", () => {
    expect(member("europe", "Czechia")).toBe(true);
    expect(member("europe", "Iceland")).toBe(true);
    expect(member("asia", "Japan")).toBe(true);
    expect(member("africa", "Madagascar")).toBe(true);
  });

  it("puts transcontinental countries in both Europe and Asia", () => {
    for (const name of ["Russia", "Turkey", "Georgia", "Cyprus"]) {
      expect(member("europe", name)).toBe(true);
      expect(member("asia", name)).toBe(true);
    }
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
    expect(member("africa", "Somaliland")).toBe(true);
    expect(member("asia", "N. Cyprus")).toBe(true);
  });

  it("keeps neighbours out", () => {
    expect(member("europe", "Morocco")).toBe(false);
    expect(member("europe", "Greenland")).toBe(false);
    expect(member("asia", "Egypt")).toBe(false);
    expect(member("africa", "Saudi Arabia")).toBe(false);
  });
});

describe("getContinentOutline", () => {
  it("returns one merged MultiPolygon per continent, cached", () => {
    for (const c of ["europe", "asia", "africa"] as const) {
      const o = getContinentOutline(c);
      expect(o.geometry.type).toBe("MultiPolygon");
      expect(o.geometry.type === "MultiPolygon" && o.geometry.coordinates.length).toBeGreaterThan(0);
      expect(getContinentOutline(c)).toBe(o);
    }
  });
});
