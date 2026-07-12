import { describe, expect, it } from "vitest";
import { findIdOf, mapIdOf, mapMetaOf } from "./importZip";

describe("findIdOf", () => {
  it("takes the first + token of the full find/crop name", () => {
    expect(
      findIdOf("27270+00032+RATIBOŘ_POLE001g+NORMÁLNÍ+NE+BezPoznámky.jpg"),
    ).toBe(27270);
  });

  it("handles the short crop form <ID>.jpg", () => {
    expect(findIdOf("27270.jpg")).toBe(27270);
    expect(findIdOf("16330.jpeg")).toBe(16330);
  });

  it("rejects names not starting with a positive integer", () => {
    expect(findIdOf("RATIBOŘ_POLE001g+…")).toBeNull();
    expect(findIdOf("0+x.jpg")).toBeNull();
    expect(findIdOf("+27270.jpg")).toBeNull();
    expect(findIdOf("abc.jpg")).toBeNull();
  });
});

describe("mapIdOf", () => {
  it("takes the last + segment (5-digit MAP_ID) of the map name", () => {
    expect(
      mapIdOf("BRNO_HERČÍKOVA001+Nepamatuji+GPS49.23034S+16.58445V+Z19+00072.png"),
    ).toBe("00072");
  });

  it("rejects a last segment that isn't exactly 5 digits", () => {
    expect(mapIdOf("BRNO001+desc+72.png")).toBeNull(); // 2 digits
    expect(mapIdOf("BRNO001+desc+123456.png")).toBeNull(); // 6 digits
    expect(mapIdOf("BRNO001.png")).toBeNull(); // no + segments
    expect(mapIdOf("BRNO001+desc+abcde.png")).toBeNull(); // not digits
  });
});

describe("mapMetaOf", () => {
  it("takes location code (1st segment) + description (2nd segment)", () => {
    expect(
      mapMetaOf("BRNO_HERČÍKOVA001+Nepamatuji+GPS49.23034S+16.58445V+Z19+00072.png"),
    ).toEqual({ locationCode: "BRNO_HERČÍKOVA001", description: "Nepamatuji" });
  });

  it("returns null description when there's no second segment", () => {
    expect(mapMetaOf("BRNO001.png")).toEqual({
      locationCode: "BRNO001",
      description: null,
    });
  });
});
