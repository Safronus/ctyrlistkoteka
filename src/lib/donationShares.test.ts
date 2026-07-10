import { describe, expect, it } from "vitest";
import { sharedPhotoFilename, sharedThumbFilename } from "./donationShares";
import { mergeDonationShares, type FindPhotoEntry } from "./findPhotos";

const SHA = "a".repeat(40);
const SHB = "b".repeat(40);
const PREFIX = "/generated/find-photos";

describe("shared photo filenames", () => {
  it("public photo → web + thumb names", () => {
    expect(sharedPhotoFilename(SHA, false)).toBe(`s_${SHA}_DAR.webp`);
    expect(sharedThumbFilename(SHA)).toBe(`s_${SHA}_DAR.thumb.webp`);
  });

  it("anon photo → web name carries _ANON so the Nginx regex 404s it", () => {
    const name = sharedPhotoFilename(SHA, true);
    expect(name).toBe(`s_${SHA}_DAR_ANON.webp`);
    // The Nginx anon location keys on the `_ANON.<ext>` suffix; matching it
    // is what makes the file 404 for the public.
    expect(name.endsWith("_ANON.webp")).toBe(true);
  });

  it("shared names start with s_ so the per-find `^\\d+` reader regex skips them", () => {
    expect(/^\d/.test(sharedPhotoFilename(SHA, false))).toBe(false);
    expect(/^\d/.test(sharedThumbFilename(SHA))).toBe(false);
  });
});

describe("mergeDonationShares", () => {
  it("links a public shared photo with url + thumbUrl", () => {
    const byFindId = new Map<number, FindPhotoEntry[]>();
    const present = new Set([`s_${SHA}_DAR.webp`, `s_${SHA}_DAR.thumb.webp`]);
    mergeDonationShares(
      byFindId,
      { assignments: { "100": [{ slot: "a", sha1: SHA, anon: false }] } },
      present,
      PREFIX,
    );
    expect(byFindId.get(100)).toEqual([
      {
        slot: "a",
        isAnonymized: false,
        url: `${PREFIX}/s_${SHA}_DAR.webp`,
        thumbUrl: `${PREFIX}/s_${SHA}_DAR.thumb.webp`,
        filename: `s_${SHA}_DAR.webp`,
      },
    ]);
  });

  it("anon link hides both url and thumbUrl", () => {
    const byFindId = new Map<number, FindPhotoEntry[]>();
    mergeDonationShares(
      byFindId,
      { assignments: { "100": [{ slot: "a", sha1: SHA, anon: true }] } },
      new Set([`s_${SHA}_DAR_ANON.webp`]),
      PREFIX,
    );
    const e = byFindId.get(100)?.[0];
    expect(e?.url).toBeNull();
    expect(e?.thumbUrl).toBeNull();
    expect(e?.isAnonymized).toBe(true);
    expect(e?.filename).toBe(`s_${SHA}_DAR_ANON.webp`);
  });

  it("skips an orphan link whose file is no longer on disk", () => {
    const byFindId = new Map<number, FindPhotoEntry[]>();
    mergeDonationShares(
      byFindId,
      { assignments: { "100": [{ slot: "a", sha1: SHB, anon: false }] } },
      new Set(),
      PREFIX,
    );
    expect(byFindId.has(100)).toBe(false);
  });

  it("falls back to thumbUrl:null when the web file exists but the thumb doesn't", () => {
    const byFindId = new Map<number, FindPhotoEntry[]>();
    mergeDonationShares(
      byFindId,
      { assignments: { "100": [{ slot: "a", sha1: SHA, anon: false }] } },
      new Set([`s_${SHA}_DAR.webp`]),
      PREFIX,
    );
    expect(byFindId.get(100)?.[0]?.thumbUrl).toBeNull();
    expect(byFindId.get(100)?.[0]?.url).toBe(`${PREFIX}/s_${SHA}_DAR.webp`);
  });

  it("appends to a find's existing per-find photos rather than replacing", () => {
    const byFindId = new Map<number, FindPhotoEntry[]>([
      [
        100,
        [
          {
            slot: "a",
            isAnonymized: false,
            url: "/x",
            thumbUrl: null,
            filename: "100a_DAR.jpeg",
          },
        ],
      ],
    ]);
    mergeDonationShares(
      byFindId,
      { assignments: { "100": [{ slot: "b", sha1: SHA, anon: false }] } },
      new Set([`s_${SHA}_DAR.webp`, `s_${SHA}_DAR.thumb.webp`]),
      PREFIX,
    );
    expect(byFindId.get(100)).toHaveLength(2);
  });
});
