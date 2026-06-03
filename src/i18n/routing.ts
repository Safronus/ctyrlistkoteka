import { defineRouting } from "next-intl/routing";

/**
 * Locale routing config — single source of truth for next-intl.
 *
 * - `cs` is the default locale; URLs without a prefix (`/sbirka`)
 *   resolve to Czech. English lives under `/en/...` per the user's
 *   confirmed URL strategy (sub-path, kept-Czech slugs).
 * - `localePrefix: 'as-needed'` keeps the default locale prefix-free
 *   so existing public URLs (`/sbirka/123`, `/lokality`) continue to
 *   resolve unchanged. The middleware rewrites them internally to the
 *   `[locale]` segment so server components still receive
 *   `params.locale = 'cs'`.
 * - The shared pathnames map is intentionally empty for now — slugs
 *   stay Czech in both locales (`/sbirka` vs `/en/sbirka`). When/if we
 *   later want translated paths (`/en/collection`), this is where it
 *   lives.
 */
export const routing = defineRouting({
  locales: ["cs", "en"] as const,
  defaultLocale: "cs",
  localePrefix: "as-needed",
  // Disable next-intl's automatic locale detection. With it on (the
  // default), the middleware reads the `NEXT_LOCALE` cookie and the
  // `Accept-Language` header, and 307-redirects every prefix-free URL
  // (`/sbirka`) to the cookied locale (`/en/sbirka`) — including the
  // ones the user is *explicitly trying to reach* via the locale
  // switcher's CZ pill. Result: clicking CZ from EN ends up back on
  // EN, the page seems "stuck" until private browsing wipes the
  // cookie. Hard rule for this site: the URL alone determines the
  // locale; the visitor's choice survives across navigations because
  // the URL changes, not because of a hidden cookie.
  localeDetection: false,
  // Don't emit the `NEXT_LOCALE` cookie at all. The locale is decided
  // purely by the URL (see above), detection is off, and the switcher
  // navigates by URL — so the cookie is never read and only adds a
  // `Set-Cookie` without HttpOnly that security scanners (rightly)
  // flag. Disabling it removes that finding with zero behaviour change.
  localeCookie: false,
});

export type Locale = (typeof routing.locales)[number];
