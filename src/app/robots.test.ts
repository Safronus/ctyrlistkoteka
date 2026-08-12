import { describe, expect, it } from "vitest";
import robots from "./robots";

/**
 * The crawler must be told to stay away from every path that exists to be
 * reached by hand: the QR targets, and `/tym/<token>` — behind whose
 * password sit the hiding coordinates of a whole area.
 *
 * A rule dropped from this list is invisible in review and silent in
 * production until something turns up in a search index.
 */
describe("robots.txt", () => {
  it("disallows the hand-reached paths", () => {
    const rules = robots().rules;
    const disallow = (Array.isArray(rules) ? rules : [rules]).flatMap((r) =>
      Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : [],
    );
    for (const p of ["/api/", "/go/", "/n/", "/d/", "/tym/"]) {
      expect(disallow).toContain(p);
    }
  });

  it("does not advertise /admin", () => {
    // Deliberate: robots.txt is world-readable, so a Disallow line would
    // point at the admin instead of hiding it. See the note in robots.ts.
    const rules = robots().rules;
    const disallow = (Array.isArray(rules) ? rules : [rules]).flatMap((r) =>
      Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : [],
    );
    expect(disallow.some((p) => p.includes("admin"))).toBe(false);
  });
});
