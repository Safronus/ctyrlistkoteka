/**
 * The site origin as it may be printed onto a physical card.
 *
 * QR codes on laminated clovers are the one output nobody can correct
 * afterwards. If `NEXT_PUBLIC_SITE_URL` is ever set without the scheme —
 * or with a bare `http://` — a whole wave goes out pointing at a URL that
 * redirects at best and warns the finder at worst, and there is no fixing
 * a hundred cards already hidden in a park.
 *
 * So the scheme is not taken on trust: anything that is not localhost is
 * forced to https. Localhost keeps http, because that is where the dev
 * server actually listens and a code scanned off a laptop screen has to
 * resolve.
 *
 * Parsed with `URL` rather than by hand — the host/port/trailing-slash
 * cases that regexes get wrong here are exactly the ones that would ship
 * a broken code.
 */

const FALLBACK = "https://ctyrlistkoteka.cz";

/** Hosts where the dev server genuinely speaks http. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function printableSiteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? FALLBACK).trim();
  // A bare host ("ctyrlistkoteka.cz") is not a URL; give it a scheme
  // before parsing, then let the localhost rule below decide the truth.
  const candidate = raw.includes("://") ? raw : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return FALLBACK;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return FALLBACK;
  }

  parsed.protocol = LOCAL_HOSTS.has(parsed.hostname) ? "http:" : "https:";
  // `origin` drops the path, the query and every trailing slash, which is
  // all this is ever concatenated with.
  return parsed.origin;
}
