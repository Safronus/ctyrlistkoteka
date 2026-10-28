import { describe, expect, it } from "vitest";
import {
  alreadyOnServerWarning,
  findIdOf,
  mapIdOf,
  mapMetaOf,
  repeatedIdsWarning,
} from "./importZip";

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

describe("alreadyOnServerWarning", () => {
  it("is quiet for a package of new finds only", () => {
    expect(alreadyOnServerWarning([])).toBeNull();
  });

  it("names the finds as ranges and points to the correction package", () => {
    // An original + its crop count as one find.
    const w = alreadyOnServerWarning([31420, 31421, 31422, 31420, 500]);
    expect(w).toContain("4 nálezy z balíčku už na serveru jsou (500, 31420-31422)");
    expect(w).toContain("„oprava-nalezu“");
  });

  it("uses the singular for one find and trails off after eight ranges", () => {
    expect(alreadyOnServerWarning([7])).toMatch(/^1 nález z balíčku už na serveru je \(7\)\. .* u něj /);
    const many = Array.from({ length: 10 }, (_, i) => i * 10 + 1);
    expect(alreadyOnServerWarning(many)).toContain("(1, 11, 21, 31, 41, 51, 61, 71, …)");
  });
});

describe("repeatedIdsWarning", () => {
  it("is quiet when every id appears once", () => {
    expect(repeatedIdsWarning("finds", [1, 2, 3])).toBeNull();
  });

  it("lists each repeated id once, whatever the order", () => {
    expect(repeatedIdsWarning("crops", [5, 9, 5, 9, 5, 2])).toBe(
      "V crops/ jsou 2 čísla nálezu víckrát (5, 9). Na serveru by po importu " +
        "zůstalo víc fotek téhož nálezu a sync by použil abecedně poslední — " +
        "nech v balíčku od každého nálezu jen jeden soubor.",
    );
    expect(repeatedIdsWarning("finds", [4, 4])).toMatch(/^V finds\/ je 1 číslo nálezu víckrát \(4\)/);
  });
});
