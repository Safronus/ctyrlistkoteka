/**
 * Localized brand wordmarks.
 *
 * Czech keeps the original "(Safronova) Čtyřlístkotéka"; the English
 * locale renders it as "(Safron's) Luckographer". Kept as a tiny pure
 * helper rather than next-intl message keys so the exact same call works
 * in server metadata, server components, and client components alike —
 * no request-scope juggling and no pulling the messages bundle into the
 * header/footer just for the brand string.
 *
 * `SITE_NAME` in src/lib/constants.ts is retained as the canonical Czech
 * wordmark constant; these helpers are the source of truth for anything
 * shown to visitors. (Admin chrome and the WebAuthn relying-party label
 * stay Czech-only by design — admin isn't a localized surface.)
 */

/** Full brand name — header brand, footer copyright, document title. */
export function siteName(locale: string): string {
  return locale === "en"
    ? "Safron's Luckographer"
    : "Safronova čtyřlístkotéka";
}

/** Short wordmark with no "Safron's" / "Safronova" prefix — the hero <h1>. */
export function siteNameShort(locale: string): string {
  return locale === "en" ? "Luckographer" : "Čtyřlístkotéka";
}
