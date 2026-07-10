/**
 * Spoofing-resistant client-IP resolution behind our Nginx.
 *
 * Deployment shape: every request reaches Next.js exclusively through
 * Nginx (see deploy/nginx.conf.template), which sets on all proxied
 * locations:
 *
 *   proxy_set_header X-Real-IP       $remote_addr;
 *   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 *
 * `X-Real-IP` is OVERWRITTEN with the TCP peer address, so the client
 * cannot forge it — that's the value to trust. `X-Forwarded-For` is
 * APPENDED to: a client can send `X-Forwarded-For: 1.2.3.4` and Nginx
 * turns it into `1.2.3.4, <real-ip>`. Reading the FIRST element (the
 * common mistake this module replaces) therefore hands the attacker
 * control of the logged/fingerprinted IP; the only element our proxy
 * vouches for is the LAST one.
 *
 * In local dev (`next dev`, no proxy) neither header exists and the
 * function returns null — callers pick their own fallback ("unknown"
 * for audit logs, "" for vote fingerprints), matching prior behaviour.
 */

/** Minimal read-only view of a headers list — keeps the function pure
 *  and unit-testable without `next/headers`. */
interface HeaderReader {
  get(name: string): string | null;
}

export function clientIpFromHeaders(h: HeaderReader): string | null {
  const realIp = h.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  // Fallback for environments without the X-Real-IP directive: take the
  // LAST hop of the chain — the one appended by the proxy in front of
  // us — never the client-controlled first element.
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",");
    const last = parts.at(-1)?.trim();
    if (last) return last;
  }
  return null;
}
