import { printableSiteUrl } from "@/lib/printableSiteUrl";

/**
 * The URL a CaSQB code actually encodes — the thing a phone shows in its
 * scan banner before anyone taps.
 *
 * A phone displays the encoded host and never follows redirects first (a
 * phishing safeguard, not a setting). So for the banner to read
 * "casqb.org" the encoded URL must live on a CaSQB domain that forwards
 * to our `/go/<token>` — a subdomain pointed at the VPS, or a redirect
 * rule on casqb.org itself. `CASQB_QR_BASE_URL` is that prefix; unset,
 * codes encode this site's own `/go`. Changing it changes what NEW
 * downloads encode — a code already printed keeps working either way,
 * because `/go/<token>` on this site never stops resolving.
 */

/** Prefix without a trailing slash, e.g. `https://ctyrlistkoteka.cz/go`
 *  or `https://qr.casqb.org`. Server-only: reads a non-public env var. */
export function casqbEncodedBase(): string {
  const raw = process.env.CASQB_QR_BASE_URL?.trim();
  if (raw) {
    // Parsed, not pattern-matched: https only, a real host, nothing after
    // the path (a query or fragment would end up inside every code).
    try {
      const u = new URL(raw);
      if (u.protocol === "https:" && u.hostname.includes(".") && !u.search && !u.hash) {
        return `${u.origin}${u.pathname}`.replace(/\/$/, "");
      }
    } catch {
      /* fall through to the site's own /go */
    }
  }
  // printableSiteUrl, ne holá proměnná: tohle končí v tištěném kódu a na
  // VPS je `NEXT_PUBLIC_SITE_URL` bez TLS. Voláno až tady, ne do
  // konstanty na úrovni modulu — jinak by se hodnota zapekla při importu
  // a testy by ji nemohly podstrčit.
  return `${printableSiteUrl()}/go`;
}

export function casqbEncodedUrl(token: string): string {
  return `${casqbEncodedBase()}/${token}`;
}

/** What the admin shows next to a code: the encoded URL without its
 *  scheme, the way a phone's banner would print it. */
export function casqbEncodedLabel(token: string): string {
  return casqbEncodedUrl(token).replace(/^https:\/\//, "");
}
