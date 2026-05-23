import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CloverThumbIcon } from "@/components/icons/clover-thumb-icon";
import { formatShortDateTimeCs } from "@/lib/format";
import type { TopFindRich } from "@/lib/votes";

/**
 * Homepage "Nejoblíbenější čtyřlístek" panel — surfaces the #1 find
 * by all-time votes. Sits between the summary stats row and the
 * Retrospective grid so it reads as an "ongoing community pick"
 * spotlight rather than an end-of-page footnote.
 *
 * Styling tracks the site's brand-green palette (no amber/orange —
 * that fought with the otherwise green page chrome). Anonymized
 * winner shows just the thumbnail + count + anon label; the
 * location/date are stripped per CLAUDE.md §6.
 *
 * Server component: parent renders the data, this just lays out the
 * markup.
 */
export async function PopularFindWidget({
  winner,
}: {
  /** Top non-anonymized find OR an anonymized one — both are allowed
   *  per the design discussion. `null` → no votes yet, widget hides. */
  winner: TopFindRich | null;
}) {
  if (!winner) return null;
  const [t, tRow, locale] = await Promise.all([
    getTranslations("Popular"),
    getTranslations("FindRow"),
    getLocale(),
  ]);

  // Two paths: anonymized vs public. The non-anonymized branch shows
  // date + location code/displayName; the anon branch only shows the
  // ID + thumbnail + vote count.
  const dateLine =
    !winner.isAnonymized && winner.foundAt
      ? formatShortDateTimeCs(new Date(winner.foundAt), locale)
      : null;
  const locationLine =
    !winner.isAnonymized && winner.location
      ? winner.location.displayName &&
        winner.location.displayName !== winner.location.code
        ? `${winner.location.code} — ${winner.location.displayName}`
        : winner.location.code
      : null;

  return (
    <section
      aria-labelledby="popular-find-heading"
      className="rounded-2xl border border-brand-200 bg-brand-50/60 p-4 sm:p-5"
    >
      <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
        <Link
          href={`/sbirka/${winner.findId}`}
          className="group relative block aspect-square w-full max-w-[180px] overflow-hidden rounded-xl border border-brand-200 bg-white sm:w-40"
          aria-label={t("openFind")}
        >
          {winner.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={winner.thumbUrl}
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform group-hover:scale-[1.04]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-brand-400">
              <CloverThumbIcon filled className="h-16 w-16" />
            </div>
          )}
          <span
            aria-hidden
            className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/90 px-1.5 py-0.5 text-xs font-bold text-brand-700 shadow-sm backdrop-blur-sm"
          >
            {t("rankPrefix")}1
          </span>
        </Link>
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-brand-700">
            <CloverThumbIcon filled className="h-4 w-4" />
            {t("homepageSubtitle")}
          </p>
          <h2
            id="popular-find-heading"
            className="text-2xl font-bold text-gray-900 sm:text-3xl"
          >
            {t("homepageTitle")}
          </h2>
          <dl className="space-y-1 text-sm text-gray-700">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <dt className="text-gray-500">{t("homepageFindLabel")}</dt>
              <dd>
                <Link
                  href={`/sbirka/${winner.findId}`}
                  className="font-mono font-semibold text-brand-700 hover:underline"
                >
                  #{winner.findId}
                </Link>
              </dd>
            </div>
            {dateLine && (
              <div className="flex flex-wrap items-baseline gap-x-2">
                <dt className="text-gray-500">{t("homepageDateLabel")}</dt>
                <dd className="font-mono tabular-nums text-gray-700">
                  {dateLine}
                </dd>
              </div>
            )}
            {locationLine && (
              <div className="flex flex-wrap items-baseline gap-x-2">
                <dt className="text-gray-500">{t("homepageLocationLabel")}</dt>
                <dd className="truncate text-gray-700" title={locationLine}>
                  {locationLine}
                </dd>
              </div>
            )}
            {winner.isAnonymized && (
              <div className="text-gray-500">{tRow("anonymizedLocation")}</div>
            )}
            <div className="flex flex-wrap items-baseline gap-x-2">
              <dt className="text-gray-500">{t("homepageVotesLabel")}</dt>
              <dd className="font-mono tabular-nums font-semibold text-brand-700">
                {t("voteCount", { count: winner.voteCount })}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
