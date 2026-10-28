import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { isAdminPath, middleware } from "./middleware";

/**
 * The /admin cloak: a request Nginx refused at the IP allowlist arrives with
 * `X-Ctyr-Cloak: 1` and must take the same road as any unknown URL (a
 * next-intl rewrite into `[locale]`, whose catch-all 404s) — never the real
 * admin. Without the header, admin is untouched.
 */

function run(path: string, headers: Record<string, string> = {}) {
  const request = new NextRequest(`http://localhost:3000${path}`, { headers });
  return { request, response: middleware(request) };
}

describe("isAdminPath", () => {
  it("matches /admin and below, not look-alikes", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/sync")).toBe(true);
    expect(isAdminPath("/adminx")).toBe(false);
    expect(isAdminPath("/administrace")).toBe(false);
    expect(isAdminPath("/api/admin/sync")).toBe(false);
  });
});

describe("middleware — admin cloak", () => {
  it("routes a cloaked admin URL exactly like an unknown URL", () => {
    const cloaked = run("/admin/sync", { "x-ctyr-cloak": "1" }).response;
    const unknown = run("/qqqqq/sync").response;
    expect(cloaked.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/cs/admin/sync",
    );
    expect(unknown.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/cs/qqqqq/sync",
    );
    // Nothing that would single the admin URL out.
    expect(cloaked.headers.get("x-robots-tag")).toBeNull();
    expect(cloaked.headers.get("cache-control")).toBe(unknown.headers.get("cache-control"));
  });

  it("never passes the marker on to the app", () => {
    const { request } = run("/admin", { "x-ctyr-cloak": "1" });
    expect(request.headers.get("x-ctyr-cloak")).toBeNull();
  });

  it("leaves admin alone without the marker (or with any other value)", () => {
    const variants: Record<string, string>[] = [{}, { "x-ctyr-cloak": "0" }, { "x-ctyr-cloak": "yes" }];
    for (const headers of variants) {
      const { response } = run("/admin/sync", headers);
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("ignores the marker outside admin", () => {
    const plain = run("/sbirka").response;
    const marked = run("/sbirka", { "x-ctyr-cloak": "1" }).response;
    expect(marked.headers.get("x-middleware-rewrite")).toBe(
      plain.headers.get("x-middleware-rewrite"),
    );
  });
});
