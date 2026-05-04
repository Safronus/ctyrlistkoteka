import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

/**
 * Server-side request config — next-intl reads this on every request
 * to know which locale to render and which message bundle to load.
 *
 * Bundles live in `/messages/<locale>.json`. Imports are statically
 * analysable so Webpack tree-shakes per-locale; runtime never has to
 * fetch a JSON over HTTP. Falling back to `defaultLocale` if the URL
 * lands on something we don't recognise keeps misconfigured links
 * harmless.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
