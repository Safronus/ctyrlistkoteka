// Hardcoded addresses are the subject matter here, not a leaked config
// value — the whole point is which literals the gate lets through.
/* eslint-disable sonarjs/no-hardcoded-ip */
import { describe, expect, it } from "vitest";
import { isLoopbackChain, tokenMatches } from "./dropSyncGate";

describe("tokenMatches", () => {
  it("accepts the exact token", () => {
    expect(tokenMatches("abc123", "abc123")).toBe(true);
  });

  it.each([
    ["a different value", "abc124"],
    ["one character short", "abc12"],
    ["one character long", "abc1234"],
    ["empty", ""],
    ["a prefix of the token", "abc"],
  ])("rejects %s", (_label, given) => {
    expect(tokenMatches(given, "abc123")).toBe(false);
  });

  it("does not throw on a length mismatch", () => {
    // timingSafeEqual throws on differing lengths; hashing first is what
    // keeps a wrong LENGTH from being distinguishable from a wrong value.
    expect(() => tokenMatches("x", "a".repeat(64))).not.toThrow();
  });
});

describe("isLoopbackChain", () => {
  it.each([
    ["no header at all", null],
    ["what Next puts there for a direct call", "::ffff:127.0.0.1"],
    ["plain IPv4 loopback", "127.0.0.1"],
    ["IPv6 loopback", "::1"],
    ["bracketed IPv6 loopback", "[::1]"],
    ["another 127/8 address", "127.0.1.5"],
    ["several loopback hops", "127.0.0.1, ::1"],
  ])("allows %s", (_label, header) => {
    expect(isLoopbackChain(header)).toBe(true);
  });

  it.each([
    ["a real client through Nginx", "203.0.113.9"],
    // The one that matters: Nginx APPENDS the real peer, so forging a
    // loopback entry cannot hide the attacker's own address.
    ["a forged loopback with the real peer appended", "127.0.0.1, 203.0.113.9"],
    ["a forged IPv6 loopback with the peer appended", "::1, 203.0.113.9"],
    ["a chain of proxies", "10.0.0.5, 203.0.113.9"],
    ["an address that merely starts with 12", "12.7.0.1"],
    ["a private address", "192.168.1.10"],
  ])("refuses %s", (_label, header) => {
    expect(isLoopbackChain(header)).toBe(false);
  });
});
