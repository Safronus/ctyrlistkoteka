import { describe, expect, it } from "vitest";
import { getUsStates, usStateFromCoords } from "./us-states";

describe("getUsStates", () => {
  it("has the 50 states + DC and drops the island territories", () => {
    const fc = getUsStates();
    expect(fc.features).toHaveLength(51);
    const names = new Set(fc.features.map((f) => f.properties.name));
    expect(names.has("California")).toBe(true);
    expect(names.has("District of Columbia")).toBe(true);
    // geoAlbersUsa can't place these, so they're excluded.
    expect(names.has("Puerto Rico")).toBe(false);
    expect(names.has("Guam")).toBe(false);
  });

  it("returns the same cached instance", () => {
    expect(getUsStates()).toBe(getUsStates());
  });
});

describe("usStateFromCoords", () => {
  it.each([
    ["Washington DC", 38.8977, -77.0365, "11", "District of Columbia"],
    ["Los Angeles", 34.0522, -118.2437, "06", "California"],
    ["New York City", 40.7128, -74.006, "36", "New York"],
    // Alaska and Hawaii prove the insets' source geometry is present.
    ["Honolulu", 21.3069, -157.8583, "15", "Hawaii"],
    ["Anchorage", 61.2181, -149.9003, "02", "Alaska"],
  ])("resolves %s", (_label, lat, lng, code, name) => {
    const r = usStateFromCoords(lat, lng);
    expect(r).not.toBeNull();
    expect(r!.code).toBe(code);
    expect(r!.name).toBe(name);
  });

  it("returns null outside the USA", () => {
    expect(usStateFromCoords(49.2, 17.66)).toBeNull(); // Zlín, ČR
    expect(usStateFromCoords(30, -40)).toBeNull(); // mid-Atlantic
  });
});
