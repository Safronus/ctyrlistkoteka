import { randomInt } from "node:crypto";
import { getTranslations } from "next-intl/server";
import { CloverHunt } from "@/components/not-found/clover-hunt";

/**
 * The public site's 404: a clover hunt — „Louka“ or „Lupa“, picked at
 * random per request — inside the `[locale]` root (nav, footer, CSP nonce).
 * Serves unknown URLs (the `[...rest]` catch-all), missing finds, and a
 * cloaked /admin request alike, so it must never show anything taken from
 * the request: no path, no query. Everything interactive runs in the
 * browser; the only call out is the site's own /api/random-find.
 */
export default async function NotFound() {
  const t = await getTranslations("NotFound");
  const game = randomInt(2) === 0 ? "meadow" : "lens";
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col items-center gap-3 px-4 py-10 sm:py-14">
      <h1 className="text-center text-2xl font-bold text-gray-900 sm:text-3xl">{t("title")}</h1>
      <p className="mb-4 max-w-xl text-center text-sm text-gray-600 sm:text-base">{t("subtitle")}</p>
      <CloverHunt game={game} />
    </section>
  );
}
