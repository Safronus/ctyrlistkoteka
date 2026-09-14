import { afterEach, describe, expect, it, vi } from "vitest";
import { casqbEncodedBase, casqbEncodedLabel, casqbEncodedUrl } from "./casqbEncoded";

afterEach(() => vi.unstubAllEnvs());

describe("casqbEncodedBase", () => {
  it("defaults to this site's /go", () => {
    vi.stubEnv("CASQB_QR_BASE_URL", "");
    expect(casqbEncodedBase()).toMatch(/\/go$/);
    expect(casqbEncodedUrl("m6VZ5H")).toMatch(/\/go\/m6VZ5H$/);
  });

  it("takes a CaSQB host, with or without a path, trailing slash dropped", () => {
    vi.stubEnv("CASQB_QR_BASE_URL", "https://qr.casqb.org/");
    expect(casqbEncodedUrl("m6VZ5H")).toBe("https://qr.casqb.org/m6VZ5H");
    vi.stubEnv("CASQB_QR_BASE_URL", "https://casqb.org/q");
    expect(casqbEncodedUrl("m6VZ5H")).toBe("https://casqb.org/q/m6VZ5H");
    expect(casqbEncodedLabel("m6VZ5H")).toBe("casqb.org/q/m6VZ5H");
  });

  it("ignores anything that is not a bare https base", () => {
    for (const bad of [
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- the case under test
      "http://qr.casqb.org",
      "https://localhost",
      "https://casqb.org/q?x=1",
      "https://casqb.org/#a",
      "casqb.org",
    ]) {
      vi.stubEnv("CASQB_QR_BASE_URL", bad);
      expect(casqbEncodedBase(), bad).toMatch(/\/go$/);
    }
  });
});
