import { Heart, MapPin } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CloverThumbIcon } from "@/components/icons/clover-thumb-icon";
import { VoteButton } from "@/components/finds/vote-button";
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

  // Map deep-link mirrors LatestFindSection — non-anonymized winners
  // with public coords go to /mapa?find=<id>; anonymized winners
  // skip the link (their GPS is stripped on the public site).
  const showMapLink = !winner.isAnonymized;

  return (
    <section
      aria-labelledby="popular-find-heading"
      // mt-8 separates the widget from the summary stats above so it
      // doesn't visually glue to the StatCards row. Matches the gap
      // the other top-level sections (Highlights, LatestFind) leave.
      className="mt-8 flex items-stretch overflow-hidden rounded-2xl border border-brand-200 bg-brand-50/60"
    >
      <div className="grid flex-1 gap-4 p-4 sm:grid-cols-[auto_1fr] sm:items-center sm:p-5">
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
          {/* "Darovaný" badge — bottom-right per the request. Same
              rose-tinted shape as the jubilee tile + /statistiky
              leaderboard so all three surfaces feel consistent. */}
          {winner.isDonated && (
            <span
              className="absolute bottom-2 right-2 inline-flex items-center gap-0.5 rounded-md bg-rose-100/95 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-800 shadow-sm backdrop-blur-sm"
              aria-label={t("donatedBadge")}
              title={t("donatedBadge")}
            >
              <Heart className="h-2.5 w-2.5" aria-hidden />
              {t("donatedBadge")}
            </span>
          )}
        </Link>
        {/* `relative` hosts the absolutely-positioned vote CTA below
         *  on sm:+ so it floats top-right WITHOUT contributing to
         *  the flex column's row heights (avoids the vertical gap
         *  between subtitle and title that a normal-flow flex row
         *  would open). On mobile the absolute position is dropped
         *  and the button drops to the bottom of the column via
         *  `order-last` — there's no horizontal room to float it
         *  top-right next to the subtitle without colliding with
         *  the map-pin rail or wrapping the title prematurely.
         *  Subtitle + title get sm:pr-24 to clear the desktop float;
         *  on mobile they take the full column width. */}
        <div className="relative flex flex-col gap-2">
          <div className="order-last pt-1 sm:absolute sm:right-0 sm:top-0 sm:order-none sm:pt-0">
            <VoteButton
              findId={winner.findId}
              initialVoted={false}
              initialCount={winner.voteCount}
              size="lg"
              autoHydrate
            />
          </div>
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-brand-700 sm:pr-24">
            <CloverThumbIcon filled className="h-4 w-4" />
            {t("homepageSubtitle")}
          </p>
          <h2
            id="popular-find-heading"
            className="text-2xl font-bold text-gray-900 sm:pr-24 sm:text-3xl"
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
      {showMapLink && (
        // Separate map-pin rail on the right, identical pattern to
        // LatestFindSection. Keeps the main link to the find detail
        // intact while offering a one-click jump to the map view.
        <Link
          href={`/mapa?find=${winner.findId}`}
          aria-label={t("showOnMap")}
          title={t("showOnMap")}
          className="flex shrink-0 items-center justify-center border-l border-brand-200 px-3 text-brand-600 transition hover:bg-brand-100 hover:text-brand-800 focus:bg-brand-100 focus:text-brand-800 focus:outline-none sm:px-4"
        >
          <MapPin className="h-5 w-5" aria-hidden />
        </Link>
      )}
    </section>
  );
}
