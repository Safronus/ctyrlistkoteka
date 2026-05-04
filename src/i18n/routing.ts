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
});

export type Locale = (typeof routing.locales)[number];
