import { describe, expect, it } from "vitest";
import { expiredBuckets, parseBucketTime } from "./trash";

const NOW = new Date("2026-08-10T12:00:00Z");

describe("parseBucketTime", () => {
  it("reads a bucket name as UTC", () => {
    expect(parseBucketTime("20260810T113652")?.toISOString()).toBe(
      "2026-08-10T11:36:52.000Z",
    );
  });

  it.each([
    ["a scope directory that slipped in", "crops"],
    ["a partial timestamp", "20260810"],
    ["a stray file extension", "20260810T113652.log"],
    ["something with the right length but not digits", "abcdefghTijklmn"],
    ["empty", ""],
    ["a date that does not exist", "20260231T000000"],
    ["month 13", "20261310T000000"],
  ])("refuses to date %s", (_label, name) => {
    expect(parseBucketTime(name)).toBeNull();
  });
});

describe("expiredBuckets", () => {
  it("removes what is past the window and keeps what is not", () => {
    const names = [
      "20260601T090000", // 70 days — out
      "20260709T120000", // 32 days — out
      "20260711T115959", // a second past 30 days — out
      "20260711T120000", // 30 days to the second — stays
      "20260712T000000", // 29 days — stays
      "20260810T110000", // an hour ago — stays
    ];
    expect(expiredBuckets(names, NOW)).toEqual([
      "20260601T090000",
      "20260709T120000",
      "20260711T115959",
    ]);
  });

  it("never returns a name it could not date", () => {
    // The safety rule: an unrecognised directory is someone else's, and
    // deleting it is not this function's call.
    const names = ["crops", "README", ".keep", "20260101T000000"];
    expect(expiredBuckets(names, NOW)).toEqual(["20260101T000000"]);
  });

  it("keeps a bucket exactly on the boundary", () => {
    // 30 days to the second is not yet OLDER than 30 days, so it stays;
    // one second earlier is, so it goes.
    expect(expiredBuckets(["20260711T120000"], NOW, 30)).toEqual([]);
    expect(expiredBuckets(["20260711T115959"], NOW, 30)).toEqual([
      "20260711T115959",
    ]);
  });

  it("honours a different retention window", () => {
    const names = ["20260805T120000", "20260801T120000"];
    expect(expiredBuckets(names, NOW, 7)).toEqual(["20260801T120000"]);
  });

  it("returns nothing for an empty bin", () => {
    expect(expiredBuckets([], NOW)).toEqual([]);
  });
});
