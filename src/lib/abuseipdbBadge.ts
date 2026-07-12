import { unstable_cache } from "next/cache";

/**
 * "IPs reported" count for the AbuseIPDB contributor badge shown in the
 * footer. The official badge is an <img> served from abuseipdb.com — we do
 * NOT embed it: that would make every visitor's browser hit abuseipdb.com
 * (leaking their IP) and it's blocked by our CSP img-src anyway. Instead the
 * server fetches the badge SVG itself, parses the number out of it, and the
 * footer renders it as plain local text. No visitor data ever reaches a third
 * party; the only outbound request is this cached server-side one (the VPS
 * already talks to abuseipdb.com to file the reports).
 *
 * The contributor id is public (it's in the badge URL); override via env only
 * if the account changes.
 */
const CONTRIBUTOR_ID = process.env.ABUSEIPDB_CONTRIBUTOR_ID ?? "254988";
const BADGE_SVG_URL = `https://www.abuseipdb.com/contributor/${CONTRIBUTOR_ID}.svg`;

/** Public contributor profile — the link target for the footer badge. */
export const ABUSEIPDB_CONTRIBUTOR_URL = `https://www.abuseipdb.com/user/${CONTRIBUTOR_ID}`;

/** Pulls the reported-IP count out of the badge SVG text, e.g.
 *  "…8,925  IPs  Reported…" → 8925. Returns null if the shape changes. */
export function parseReportedCount(svg: string): number | null {
  // Drop tags and collapse whitespace so the count sits right before " IPs".
  const text = svg.replace(/<[^<>]*>/g, " ").replace(/\s+/g, " ");
  const marker = text.toLowerCase().indexOf(" ips");
  if (marker < 0) return null;
  // Walk back from " IPs" over the run of digits/commas (the count). A plain
  // scan avoids a char-class-quantifier regex (super-linear-regex noise).
  let start = marker;
  while (start > 0) {
    const c = text.charCodeAt(start - 1);
    const isDigit = c >= 48 && c <= 57;
    const isComma = c === 44;
    if (!isDigit && !isComma) break;
    start -= 1;
  }
  if (start === marker) return null;
  const n = Number(text.slice(start, marker).replace(/,/g, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function fetchReportedCount(): Promise<number | null> {
  try {
    const res = await fetch(BADGE_SVG_URL, {
      // NB: do NOT add `cache: "no-store"` here — Next throws on a no-store
      // fetch inside unstable_cache, and our catch would swallow it into a
      // null (that was the original empty-count bug). unstable_cache owns the
      // result caching; the signal just bounds a slow request.
      signal: AbortSignal.timeout(8000),
      headers: {
        // abuseipdb.com is behind Cloudflare; the badge is normally fetched
        // by browsers (it's embedded via <img>), so present a browser-shaped
        // Accept + UA to avoid bot mitigation on the datacenter IP.
        accept: "image/svg+xml,image/*,*/*;q=0.8",
        "accept-language": "en;q=0.8",
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) return null;
    return parseReportedCount(await res.text());
  } catch {
    // Network error / timeout / abuseipdb down — the footer just omits the
    // number. Never throw into the render path.
    return null;
  }
}

/** Cached (≤6 h) reported-IP count for the footer. null on any failure. */
export const getAbuseReportCount = unstable_cache(
  fetchReportedCount,
  ["abuseipdb-reported-count-v2"],
  { revalidate: 21600 },
);
