import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The two checks guarding the background sync endpoint.
 *
 * Extracted from the route so they can be tested directly. The endpoint
 * sits OUTSIDE the Nginx admin cloak — that cloak matches the prefix
 * `/admin`, and `/api/admin/...` does not start with it — so getting
 * these wrong is not a cosmetic mistake.
 *
 * `deploy/nginx.conf.template` now also answers 404 for this path, but
 * treat that as a second lock, never as the reason to relax anything
 * here: Nginx is edited by hand on the box and CI does not deploy it, so
 * the config that is actually running may not be the one in the repo.
 */

/** Constant-time token check. */
export function tokenMatches(given: string, expected: string): boolean {
  // Comparing digests rather than the raw strings keeps the comparison
  // fixed-width, so a wrong LENGTH is indistinguishable from a wrong
  // value — `timingSafeEqual` throws outright on mismatched lengths.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * True when the request came in over loopback rather than through Nginx.
 *
 * Not "is the header absent" — that was the first attempt and it was
 * wrong: **Next fills `x-forwarded-for` in by itself** from the socket,
 * so a direct call arrives carrying `::ffff:127.0.0.1` and the check
 * refused the very timer it was meant to allow.
 *
 * So inspect the CHAIN, and require every hop to be loopback. Nginx
 * builds the header as `$proxy_add_x_forwarded_for`, which always appends
 * the real peer, so a request from the internet carries at least one
 * non-loopback entry no matter what the client puts in the header
 * itself. Forging a leading `127.0.0.1` gains nothing — the attacker's
 * own address still lands after it.
 *
 * The remaining assumption is that nobody can reach port 3000 directly.
 * That is enforced at the firewall:
 * `iifname != "lo" tcp dport 3000 counter drop`
 * (deploy/nftables-ssh-allowlist.nft). If that rule ever goes, this check
 * degrades to "the token alone" — which is why it is written down here.
 */
export function isLoopbackChain(forwardedFor: string | null): boolean {
  if (!forwardedFor) return true; // no proxy in front at all
  const hops = forwardedFor
    .split(",")
    .map((h) => h.trim().replace(/^\[|\]$/g, "").replace(/^::ffff:/i, ""))
    .filter(Boolean);
  if (hops.length === 0) return true;
  return hops.every(
    (ip) => ip === "::1" || ip === "127.0.0.1" || ip.startsWith("127."),
  );
}
