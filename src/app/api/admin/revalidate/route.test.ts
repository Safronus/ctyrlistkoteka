import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/admin/revalidate is not reliably behind the Nginx admin cloak (it is
 * a prefix rule on /admin), so every failure must look like nothing is
 * there: a bare 404, never 401 / 503.
 */

const revalidatePublicSurfaces = vi.hoisted(() => vi.fn());
vi.mock("@/lib/revalidate", () => ({ revalidatePublicSurfaces }));

const { POST } = await import("./route");

const TOKEN = "test-token-0123456789";

function post(headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1:3000/api/admin/revalidate", { method: "POST", headers });
}

beforeEach(() => {
  revalidatePublicSurfaces.mockClear();
  vi.stubEnv("REVALIDATE_TOKEN", TOKEN);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/revalidate", () => {
  it("revalidates with the right bearer token (or the x-revalidate-token header)", async () => {
    const res = await POST(post({ authorization: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revalidated: true });
    expect((await POST(post({ "x-revalidate-token": TOKEN }))).status).toBe(200);
    expect(revalidatePublicSurfaces).toHaveBeenCalledTimes(2);
  });

  it("answers a bare 404 to a wrong or missing token", async () => {
    const attempts: Record<string, string>[] = [
      { authorization: "Bearer wrong" },
      {},
      { authorization: TOKEN },
    ];
    for (const headers of attempts) {
      const res = await POST(post(headers));
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not found");
    }
    expect(revalidatePublicSurfaces).not.toHaveBeenCalled();
  });

  it("answers the same 404 when the server has no token configured", async () => {
    vi.stubEnv("REVALIDATE_TOKEN", "");
    const res = await POST(post({ authorization: "Bearer " }));
    expect(res.status).toBe(404);
    expect(revalidatePublicSurfaces).not.toHaveBeenCalled();
  });
});
