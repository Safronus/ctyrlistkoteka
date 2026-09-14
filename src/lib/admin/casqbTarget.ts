/**
 * Where a CaSQB code sends people, and how the visit is labelled.
 *
 * The code itself always encodes `/go/<token>` on this site — that hop is
 * what makes a scan countable — and only the redirect knows the real
 * destination. So the destination is data the owner types, and data the
 * owner types is validated here before it is stored or followed.
 */

export const CASQB_TARGET_MAX_LENGTH = 2048;

export type ParsedTarget =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Accepts an absolute https URL and nothing else. No http (a printed
 * code outlives any "we'll add TLS later"), no credentials in the URL,
 * no fragments of our own /go path (a code pointing at a code would
 * loop), nothing that isn't a host with a dot in it.
 */
export function parseCasqbTargetUrl(input: unknown): ParsedTarget {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return { ok: false, error: "Zadej cílovou adresu." };
  if (raw.length > CASQB_TARGET_MAX_LENGTH) {
    return { ok: false, error: "Adresa je příliš dlouhá." };
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "Tohle není platná adresa (musí začínat https://)." };
  }
  if (u.protocol !== "https:") {
    return { ok: false, error: "Cíl musí být https:// — vytištěný kód přežije roky." };
  }
  if (u.username || u.password) {
    return { ok: false, error: "Adresa nesmí obsahovat přihlašovací údaje." };
  }
  if (!looksLikeDomain(u.hostname)) {
    return { ok: false, error: "Adresa musí mířit na doménu (např. https://casqb.org/)." };
  }
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://ctyrlistkoteka.cz")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (u.host === site && u.pathname.startsWith("/go/")) {
    return { ok: false, error: "Kód nemůže mířit na jiný kód." };
  }
  return { ok: true, url: u.toString() };
}

/** At least two labels, letters/digits/dashes, and an alphabetic TLD —
 *  no bare hosts, no IPs. Split rather than one regex: the obvious
 *  pattern backtracks quadratically on a long dotted string. */
function looksLikeDomain(host: string): boolean {
  const parts = host.split(".");
  if (parts.length < 2) return false;
  if (!/^[a-z]{2,}$/i.test(parts[parts.length - 1]!)) return false;
  return parts.every((p) => p.length > 0 && /^[a-z0-9-]+$/i.test(p));
}

/** utm_campaign value: the code's label, flattened to what analytics
 *  tools show intact — ASCII, lower case, dashes, capped. */
export function casqbCampaignSlug(label: string): string {
  const slug = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .split("-")
    .filter(Boolean)
    .join("-")
    .slice(0, 60)
    .split("-")
    .filter(Boolean)
    .join("-");
  return slug || "qr";
}

/**
 * The destination a scan is sent to: the stored URL plus the campaign
 * tags the owner asked for, so casqb.org's analytics can tell a scan from
 * a typed visit and one code from another. Tags the owner already put in
 * the URL win — they typed them on purpose.
 */
export function casqbDestination(targetUrl: string, label: string): URL {
  const u = new URL(targetUrl);
  const set = (k: string, v: string) => {
    if (!u.searchParams.has(k)) u.searchParams.set(k, v);
  };
  set("utm_source", "qr");
  set("utm_medium", "casqb");
  set("utm_campaign", casqbCampaignSlug(label));
  return u;
}
