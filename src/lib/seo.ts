import { routing } from "@/i18n/routing";

/**
 * Public site origin (no trailing slash) for canonical / OG / sitemap /
 * robots URLs. Forces HTTPS for the real domain — the site is always
 * served over TLS behind nginx, so a stray `http://` in
 * NEXT_PUBLIC_SITE_URL must not leak into `<link rel="canonical">` or
 * `og:url` (Google would treat the http variant as canonical). Localhost
 * keeps http for local dev.
 */
export function siteBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  try {
    const u = new URL(raw);
    const isLocal =
      u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (!isLocal && u.protocol === "http:") u.protocol = "https:";
    return u.origin;
  } catch {
    return "https://ctyrlistkoteka.cz";
  }
}

/**
 * SEO helpers shared by every page's `generateMetadata`. Keeping the
 * canonical + hreflang logic here (not copy-pasted per page) means new
 * routes — and every one of the ~17k find pages — get consistent
 * language + canonical signals automatically.
 *
 * All returned values are locale-prefixed *paths* (default locale is
 * prefix-free per `routing.localePrefix: 'as-needed'`); Next.js resolves
 * them to absolute URLs against `metadataBase` (set in the root layout).
 */

/** Locale-prefixed path for a locale-agnostic path (`/sbirka/1` → `/en/sbirka/1`). */
export function localePath(path: string, locale: string): string {
  const clean = path === "/" ? "" : path;
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  return `${prefix}${clean}` || "/";
}

/**
 * Self-referencing canonical + hreflang alternates for one page. Each
 * language version points its canonical at itself and lists all locales
 * (+ `x-default` → the Czech default) so search engines treat CZ/EN as
 * the same page in two languages.
 */
export function seoAlternates(
  path: string,
  locale: string,
): { canonical: string; languages: Record<string, string> } {
  const languages: Record<string, string> = {};
  for (const loc of routing.locales) languages[loc] = localePath(path, loc);
  languages["x-default"] = localePath(path, routing.defaultLocale);
  return { canonical: localePath(path, locale), languages };
}

/** OpenGraph `og:locale` value for a next-intl locale. */
export function ogLocale(locale: string): string {
  return locale === "en" ? "en_GB" : "cs_CZ";
}
