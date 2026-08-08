import { describe, expect, it } from "vitest";
import { parseSheetUrl } from "./dropSheet";

const ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";

describe("parseSheetUrl", () => {
  it.each([
    ["the edit URL", `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`],
    ["a share URL", `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`],
    ["no trailing path", `https://docs.google.com/spreadsheets/d/${ID}`],
    ["the published form", `https://docs.google.com/spreadsheets/d/e/${ID}/pubhtml`],
    ["a bare id", ID],
    ["surrounding whitespace", `  https://docs.google.com/spreadsheets/d/${ID}/edit  `],
  ])("accepts %s", (_label, input) => {
    expect(parseSheetUrl(input)?.documentId).toBe(ID);
  });

  it("normalises everything to one canonical URL", () => {
    expect(parseSheetUrl(`${ID}`)?.normalizedUrl).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/edit`,
    );
  });

  it.each([
    ["empty", ""],
    ["not a URL", "tabulka"],
    ["a doc, not a sheet, with no id", "https://docs.google.com/document/d/"],
    // The one that matters: a link-alike pointing somewhere else entirely
    // would otherwise have us fetching an attacker's file every 5 minutes.
    ["another host", `https://docs.google.com.evil.tld/spreadsheets/d/${ID}/edit`],
    ["plain http on another host", `http://example.com/spreadsheets/d/${ID}`],
    ["an id that is too short", "https://docs.google.com/spreadsheets/d/abc/edit"],
  ])("rejects %s", (_label, input) => {
    expect(parseSheetUrl(input)).toBeNull();
  });

  it("accepts a google subdomain", () => {
    expect(
      parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit`),
    ).not.toBeNull();
  });
});
