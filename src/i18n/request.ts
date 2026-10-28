import { locale as rootLocale } from "next/root-params";
import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

/**
 * Server-side request config — next-intl reads this on every request
 * to know which locale to render and which message bundle to load.
 *
 * The locale comes from, in order:
 *  1. an explicit override — `getTranslations({ locale })`. Route handlers
 *     and server actions MUST pass one: `next/root-params` can't be read
 *     there (Next 16.4), and the two that use next-intl already do;
 *  2. the `[locale]` root param — the public site. Read through
 *     `next/root-params`, which replaced next-intl's `requestLocale` +
 *     `setRequestLocale` pair (deprecated in next-intl 4.13.5);
 *  3. `defaultLocale` — the Czech-only roots (admin, /d, /tym) have no
 *     `[locale]` segment, so the root param is undefined there. An unknown
 *     value can't reach here from `[locale]` (its layout 404s first) but
 *     falls back the same way, as before.
 *
 * Bundles live in `/messages/<locale>.json`. Imports are statically
 * analysable so the bundler splits them per locale; runtime never has to
 * fetch a JSON over HTTP.
 */
export default getRequestConfig(async ({ locale: override }) => {
  const requested = override ?? (await rootLocale());
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
