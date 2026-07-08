import { describe, expect, it } from "vitest";
import { clientIpFromHeaders } from "./clientIp";

function makeHeaders(map: Record<string, string>): {
  get(name: string): string | null;
} {
  const lower = Object.fromEntries(
    Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { get: (name) => lower[name.toLowerCase()] ?? null };
}

describe("clientIpFromHeaders", () => {
  it("prefers X-Real-IP (the header Nginx overwrites)", () => {
    const h = makeHeaders({
      "x-real-ip": "203.0.113.7",
      "x-forwarded-for": "1.2.3.4, 203.0.113.7",
    });
    expect(clientIpFromHeaders(h)).toBe("203.0.113.7");
  });

  it("ignores a client-forged X-Forwarded-For first element", () => {
    // Attacker sent "X-Forwarded-For: 1.2.3.4"; Nginx appended the real
    // peer address. The forged first element must never win.
    const h = makeHeaders({
      "x-forwarded-for": "1.2.3.4, 198.51.100.9",
    });
    expect(clientIpFromHeaders(h)).toBe("198.51.100.9");
  });

  it("handles a single-element X-Forwarded-For (no client header sent)", () => {
    const h = makeHeaders({ "x-forwarded-for": "198.51.100.9" });
    expect(clientIpFromHeaders(h)).toBe("198.51.100.9");
  });

  it("trims whitespace around list elements", () => {
    const h = makeHeaders({ "x-forwarded-for": "1.2.3.4 ,  198.51.100.9 " });
    expect(clientIpFromHeaders(h)).toBe("198.51.100.9");
  });

  it("returns null when neither header is present (local dev)", () => {
    expect(clientIpFromHeaders(makeHeaders({}))).toBeNull();
  });

  it("returns null for empty/blank header values", () => {
    const h = makeHeaders({ "x-real-ip": "  ", "x-forwarded-for": " , " });
    expect(clientIpFromHeaders(h)).toBeNull();
  });
});
