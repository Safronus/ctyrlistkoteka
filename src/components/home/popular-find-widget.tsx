import { Heart, MapPin, Trophy } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CloverThumbIcon } from "@/components/icons/clover-thumb-icon";
import { VoteButton } from "@/components/finds/vote-button";
import { formatShortDateTimeCs } from "@/lib/format";
import type { TopFindRich } from "@/lib/votes";

type PopularT = Awaited<ReturnType<typeof getTranslations<"Popular">>>;
type FindRowT = Awaited<ReturnType<typeof getTranslations<"FindRow">>>;

/**
 * Homepage "Nejoblíbenější čtyřlístek" panel — surfaces the #1 find
 * by all-time votes, plus 2nd/3rd place as compact links.
 *
 * Layout differs by breakpoint:
 *   - Desktop (sm+): thumbnail on the left, the full winner info on the
 *     right with the vote CTA + standings floating top-right.
 *   - Mobile: thumbnail + (vote CTA + standings) side by side at the
 *     top, then the winner info below at full width — and the location
 *     line is dropped to avoid the long-code wrapping mess.
 * The `WinnerInfo` block is rendered twice (desktop / mobile variants)
 * because the two layouts place it differently; the VoteButton is
 * rendered ONCE (shared state) and just repositioned with `sm:absolute`.
 *
 * Anonymized winner shows just the thumbnail + count + anon label; the
 * location/date are stripped per CLAUDE.md §6.
 */
export async function PopularFindWidget({
  winner,
  runnersUp = [],
}: {
  /** Top non-anonymized find OR an anonymized one — both are allowed
   *  per the design discussion. `null` → no votes yet, widget hides. */
  winner: TopFindRich | null;
  /** 2nd + 3rd place (in order), each with its own vote count. Empty
   *  when the vote table has fewer than two entries. */
  runnersUp?: readonly TopFindRich[];
}) {
  if (!winner) return null;
  const [t, tRow, locale] = await Promise.all([
    getTranslations("Popular"),
    getTranslations("FindRow"),
    getLocale(),
  ]);

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

  const showMapLink = !winner.isAnonymized;

  return (
    <section
      aria-label={t("homepageTitle")}
      // mt-8 separates the widget from the summary stats above so it
      // doesn't visually glue to the StatCards row.
      className="mt-8 flex items-stretch overflow-hidden rounded-2xl border border-brand-200 bg-brand-50/60"
    >
      <div className="flex-1 p-4 sm:p-5">
        {/* Top row: thumbnail + (vote CTA + standings). On desktop the
            second column ALSO carries the full winner info (the vote
            block floats top-right over it); on mobile the second column
            is just the vote block next to the image and the info drops
            below at full width. */}
        <div className="grid grid-cols-[auto_1fr] items-start gap-4 sm:items-center">
          <Link
            href={`/sbirka/${winner.findId}`}
            className="group relative block aspect-square w-28 shrink-0 overflow-hidden rounded-xl border border-brand-200 bg-white sm:w-40"
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

          <div className="relative min-w-0">
            {/* Vote CTA + 2nd/3rd standings, right-aligned. Desktop:
                floats top-right over the info. Mobile: sits here next to
                the image. The per-place vote count rides on its own tiny
                second line so the place line stays narrow (keeps the
                desktop float clear of the title's sm:pr-24 gutter). */}
            <div className="flex flex-col items-end gap-1.5 sm:absolute sm:right-0 sm:top-0">
              <VoteButton
                findId={winner.findId}
                initialVoted={false}
                initialCount={winner.voteCount}
                size="lg"
                autoHydrate
              />
              {runnersUp.length > 0 && (
                // Wrap the standings + the "full leaderboard" button so the
                // button can stretch to exactly the standings' width (and
                // no wider) — `items-stretch` makes the column take the
                // widest child (a runner-up line), and the w-full button
                // follows it.
                <div className="flex flex-col items-stretch gap-1.5">
                  <ul className="flex flex-col items-end gap-1 text-xs leading-tight">
                    {runnersUp.map((f, i) => (
                      <li key={f.findId}>
                        <Link
                          href={`/sbirka/${f.findId}`}
                          className="block text-right text-gray-500 transition hover:text-brand-700 hover:underline"
                          aria-label={t("runnerUpAria", {
                            rank: i + 2,
                            id: f.findId,
                          })}
                        >
                          <span>
                            {i + 2}. {t("placeLabel")} —{" "}
                            <span className="font-mono font-medium text-brand-700">
                              #{f.findId}
                            </span>
                          </span>
                          <span className="block text-[10px] font-normal text-gray-400">
                            {t("voteCount", { count: f.voteCount })}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {/* Jump to /statistiky and open the full Top-10 finds
                      leaderboard (deep-link anchor handled by
                      CollapsibleSection). */}
                  <Link
                    href="/statistiky#top-finds"
                    className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                  >
                    <Trophy className="h-3 w-3 text-amber-500" aria-hidden />
                    {t("topFindsLink")}
                  </Link>
                </div>
              )}
            </div>

            {/* Desktop winner info (mobile renders its own copy below). */}
            <div className="hidden sm:block">
              <WinnerInfo
                winner={winner}
                dateLine={dateLine}
                locationLine={locationLine}
                showLocation
                t={t}
                tRow={tRow}
              />
            </div>
          </div>
        </div>

        {/* Mobile winner info — full width below the image+vote row,
            location intentionally omitted to dodge long-code wrapping.
            Plus the inline map link (desktop uses the right-hand rail). */}
        <div className="mt-3 space-y-2 sm:hidden">
          <WinnerInfo
            winner={winner}
            dateLine={dateLine}
            locationLine={locationLine}
            showLocation={false}
            t={t}
            tRow={tRow}
          />
          {showMapLink && (
            <Link
              href={`/mapa?find=${winner.findId}`}
              className="inline-flex items-center gap-1.5 self-start rounded-md border border-brand-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-brand-700 transition hover:bg-brand-100 hover:text-brand-800"
            >
              <MapPin className="h-4 w-4" aria-hidden />
              {t("showOnMap")}
            </Link>
          )}
        </div>
      </div>

      {showMapLink && (
        // Right-hand map-pin rail — desktop only (on mobile the inline
        // link above replaces it so the text isn't squeezed).
        <Link
          href={`/mapa?find=${winner.findId}`}
          aria-label={t("showOnMap")}
          title={t("showOnMap")}
          className="hidden shrink-0 items-center justify-center border-l border-brand-200 px-3 text-brand-600 transition hover:bg-brand-100 hover:text-brand-800 focus:bg-brand-100 focus:text-brand-800 focus:outline-none sm:flex sm:px-4"
        >
          <MapPin className="h-5 w-5" aria-hidden />
        </Link>
      )}
    </section>
  );
}

/** Subtitle + title + key facts for the winner. Rendered twice (desktop
 *  in the right column with the vote floating, mobile full-width below);
 *  `showLocation` is false on mobile to avoid the long location code
 *  wrapping. The h2 carries no id — the section uses aria-label — so the
 *  two copies don't collide on a duplicate id. */
function WinnerInfo({
  winner,
  dateLine,
  locationLine,
  showLocation,
  t,
  tRow,
}: {
  winner: TopFindRich;
  dateLine: string | null;
  locationLine: string | null;
  showLocation: boolean;
  t: PopularT;
  tRow: FindRowT;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-brand-700 sm:pr-24">
        <CloverThumbIcon filled className="h-4 w-4" />
        {t("homepageSubtitle")}
      </p>
      <h2 className="text-2xl font-bold text-gray-900 sm:pr-24 sm:text-3xl">
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
            <dd className="font-mono tabular-nums text-gray-700">{dateLine}</dd>
          </div>
        )}
        {showLocation && locationLine && (
          <div className="flex items-baseline gap-x-2">
            <dt className="shrink-0 text-gray-500">
              {t("homepageLocationLabel")}
            </dt>
            <dd
              className="min-w-0 flex-1 truncate text-gray-700"
              title={locationLine}
            >
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
  );
}
