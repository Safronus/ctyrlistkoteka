/* eslint-disable sonarjs/no-clear-text-protocols --
   These http:// literals are the INPUT under test: the whole point of
   printableSiteUrl is turning them into https, and the localhost cases
   assert that the dev server keeps working. */
import { afterEach, describe, expect, it } from "vitest";
import { printableSiteUrl } from "./printableSiteUrl";

const original = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = original;
});

function withEnv(value: string | undefined): string {
  if (value === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = value;
  return printableSiteUrl();
}

describe("printableSiteUrl", () => {
  it.each([
    ["http://ctyrlistkoteka.cz", "https://ctyrlistkoteka.cz"],
    ["https://ctyrlistkoteka.cz", "https://ctyrlistkoteka.cz"],
    ["ctyrlistkoteka.cz", "https://ctyrlistkoteka.cz"],
    ["https://ctyrlistkoteka.cz/", "https://ctyrlistkoteka.cz"],
    ["http://ctyrlistkoteka.cz///", "https://ctyrlistkoteka.cz"],
  ])("prints %s as %s", (input, expected) => {
    expect(withEnv(input)).toBe(expected);
  });

  it.each([
    ["http://localhost:3000", "http://localhost:3000"],
    ["https://localhost:3000", "http://localhost:3000"],
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000"],
  ])("leaves %s on http — the dev server listens there", (input, expected) => {
    expect(withEnv(input)).toBe(expected);
  });

  it("falls back to the production origin", () => {
    expect(withEnv(undefined)).toBe("https://ctyrlistkoteka.cz");
  });

  it("does not mistake a host merely starting with 'localhost'", () => {
    expect(withEnv("http://localhost.ctyrlistkoteka.cz")).toBe(
      "https://localhost.ctyrlistkoteka.cz",
    );
  });

  it("keeps a non-default port", () => {
    expect(withEnv("http://ctyrlistkoteka.cz:8443")).toBe(
      "https://ctyrlistkoteka.cz:8443",
    );
  });

  it("drops a path — only the origin is ever concatenated with", () => {
    expect(withEnv("https://ctyrlistkoteka.cz/admin?x=1")).toBe(
      "https://ctyrlistkoteka.cz",
    );
  });

  it.each([["", "not a url at all"], ["a scheme we don't print", "ftp://x.cz"]])(
    "falls back on %s",
    (_label, input) => {
      expect(withEnv(input)).toBe("https://ctyrlistkoteka.cz");
    },
  );
});
