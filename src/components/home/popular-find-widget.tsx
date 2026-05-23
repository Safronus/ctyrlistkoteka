import { getTranslations } from "next-intl/server";
import { Trophy } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { TopFindRich } from "@/lib/votes";

/**
 * Homepage "Nejoblíbenější čtyřlístek" tile — surfaces the #1 find
 * by all-time votes. Renders nothing if no find has any vote yet
 * (we don't want a placeholder card cluttering the page in that
 * cold-start state — the leaderboard on /statistiky still shows
 * its own empty state).
 *
 * Server component: the data is read in the parent page render and
 * passed in as a prop; this just lays out the markup.
 */
export async function PopularFindWidget({
  winner,
}: {
  /** Top non-anonymized find OR an anonymized one — both are allowed
   *  per the design discussion. `null` → no votes yet, widget hides. */
  winner: TopFindRich | null;
}) {
  if (!winner) return null;
  const t = await getTranslations("Popular");

  return (
    <section
      aria-labelledby="popular-find-heading"
      className="overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-emerald-50 shadow-sm"
    >
      <div className="grid gap-4 p-4 sm:grid-cols-[auto_1fr] sm:p-5">
        <Link
          href={`/sbirka/${winner.findId}`}
          className="group relative block aspect-square w-full max-w-[200px] overflow-hidden rounded-xl border border-amber-200 bg-amber-100 sm:w-44"
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
            <div className="flex h-full w-full items-center justify-center text-amber-500">
              <Trophy className="h-12 w-12" aria-hidden />
            </div>
          )}
          <span
            aria-hidden
            className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/90 px-1.5 py-0.5 text-xs font-bold text-amber-700 shadow-sm backdrop-blur-sm"
          >
            <Trophy className="h-3.5 w-3.5" aria-hidden />
            {t("rankPrefix")}1
          </span>
        </Link>
        <div className="flex flex-col justify-center gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
            {t("homepageSubtitle")}
          </p>
          <h2
            id="popular-find-heading"
            className="text-2xl font-bold text-gray-900 sm:text-3xl"
          >
            {t("homepageTitle")}
          </h2>
          <p className="font-mono text-sm tabular-nums text-gray-700">
            #{winner.findId}
            <span className="ml-3 text-amber-700">
              {t("voteCount", { count: winner.voteCount })}
            </span>
          </p>
          <Link
            href={`/sbirka/${winner.findId}`}
            className="mt-1 inline-flex w-fit items-center rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-amber-700"
          >
            {t("openFind")}
          </Link>
        </div>
      </div>
    </section>
  );
}
