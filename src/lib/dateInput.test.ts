import { describe, expect, it } from "vitest";
import {
  clampDate,
  dateInputPlaceholder,
  isoToDisplay,
  parseTypedDate,
} from "./dateInput";

describe("isoToDisplay", () => {
  it("writes Czech dates the Czech way — no leading zeros, spaced", () => {
    expect(isoToDisplay("2021-06-14", "cs")).toBe("14. 6. 2021");
    expect(isoToDisplay("2024-01-01", "cs")).toBe("1. 1. 2024");
    expect(isoToDisplay("2026-12-31", "cs")).toBe("31. 12. 2026");
  });

  it("agrees with its own placeholder", () => {
    // A field that shows "14.06.2021" under the hint "d. m. rrrr" is
    // telling the reader two different things.
    const shape = isoToDisplay("2021-06-14", "cs")
      .replace(/\d{4}/, "rrrr")
      .replace(/^\d{1,2}/, "d")
      .replace(/(?<=\. )\d{1,2}/, "m");
    expect(shape).toBe(dateInputPlaceholder("cs"));
  });

  it("leaves English on ISO", () => {
    expect(isoToDisplay("2021-06-14", "en")).toBe("2021-06-14");
  });

  it("shows nothing for an unset or malformed value", () => {
    expect(isoToDisplay("", "cs")).toBe("");
    expect(isoToDisplay("2021-6-1", "cs")).toBe("");
  });
});

describe("parseTypedDate", () => {
  it("reads back what the field displays", () => {
    for (const iso of ["2021-06-14", "2024-01-01", "2026-12-31"]) {
      expect(parseTypedDate(isoToDisplay(iso, "cs"))).toBe(iso);
    }
  });

  it("forgives separators, spacing and leading zeros", () => {
    for (const typed of [
      "1.3.2019",
      "01. 03. 2019",
      "1. 3. 2019",
      "1/3/2019",
      "1-3-2019",
      "2019-03-01",
      "  1.3.2019  ",
    ]) {
      expect(parseTypedDate(typed)).toBe("2019-03-01");
    }
  });

  it("treats an emptied field as a cleared filter, not as junk", () => {
    expect(parseTypedDate("")).toBe("");
    expect(parseTypedDate("   ")).toBe("");
  });

  it("is null while the date is still being typed", () => {
    expect(parseTypedDate("1.3")).toBeNull();
    expect(parseTypedDate("15")).toBeNull();
    expect(parseTypedDate("1.3.20")).toBeNull();
  });

  it("refuses a day the month does not have", () => {
    expect(parseTypedDate("31.2.2021")).toBeNull();
    expect(parseTypedDate("29.2.2021")).toBeNull();
    // ...but a leap day is a real day.
    expect(parseTypedDate("29.2.2024")).toBe("2024-02-29");
  });
});

describe("clampDate", () => {
  const MIN = "2021-06-14";
  const MAX = "2026-08-22";

  it("pulls a date back inside the collection", () => {
    expect(clampDate("2019-01-01", MIN, MAX)).toBe(MIN);
    expect(clampDate("2030-01-01", MIN, MAX)).toBe(MAX);
  });

  it("leaves a date inside it alone, bounds included", () => {
    expect(clampDate("2023-05-05", MIN, MAX)).toBe("2023-05-05");
    expect(clampDate(MIN, MIN, MAX)).toBe(MIN);
    expect(clampDate(MAX, MIN, MAX)).toBe(MAX);
  });

  it("passes an empty value through — that is a cleared filter", () => {
    expect(clampDate("", MIN, MAX)).toBe("");
  });
});
