import { describe, expect, it, vi } from "vitest";

/**
 * The sitemap must never advertise a tracking redirect.
 *
 * `/go/<token>` (page QR), `/n/<find id>` (find QR) and `/d/<token>` (the
 * in-the-wild drop landing pages) all exist to be reached by scanning a
 * printed code. Listing one in the sitemap would hand search engines — and
 * anyone reading it — a directory of codes that are supposed to be found in
 * the physical world, and would inflate their scan counts with crawler
 * traffic. `/tym/<token>` is worse still: behind its password sits every
 * hiding coordinate of an area, so it must never be advertised anywhere.
 * robots.txt disallows them and the handlers send
 * `X-Robots-Tag: noindex`; this test is the third lock, because the sitemap
 * is built from queries and a future "add every route" refactor is exactly
 * the kind of change that would quietly undo the other two.
 */

vi.mock("@/lib/queries/finds", () => ({
  getIndexableFinds: async () => [
    { id: 101, updatedAt: new Date("2026-01-01") },
    { id: 30001, updatedAt: new Date("2026-02-02") },
  ],
}));
vi.mock("@/lib/queries/locations", () => ({
  listLocations: async () => [{ id: 3 }, { id: 26 }],
}));

const TRACKING_PREFIXES = ["/go/", "/n/", "/d/", "/tym/"];

describe("sitemap", () => {
  it("lists no tracking-redirect URLs", async () => {
    const sitemap = (await import("./sitemap")).default;
    const entries = await sitemap();
    expect(entries.length).toBeGreaterThan(0);

    const paths = entries.flatMap((e) => [
      new URL(e.url).pathname,
      ...Object.values(e.alternates?.languages ?? {}).map(
        (u) => new URL(String(u)).pathname,
      ),
    ]);

    for (const p of paths) {
      for (const prefix of TRACKING_PREFIXES) {
        // Locale-prefixed variants too ("/en/go/…").
        expect(p.startsWith(prefix) || p.includes(prefix)).toBe(false);
      }
    }
  });

  it("still lists the public pages it is supposed to", async () => {
    const sitemap = (await import("./sitemap")).default;
    const paths = (await sitemap()).map((e) => new URL(e.url).pathname);
    expect(paths).toContain("/");
    expect(paths).toContain("/sbirka");
    expect(paths).toContain("/sbirka/101");
  });
});
