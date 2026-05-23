"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Trophy } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { VoteButton } from "@/components/finds/vote-button";
import type { TopFindRich } from "@/lib/votes";

interface Props {
  /** Rich entries for the all-time leaderboard. */
  allTime: readonly TopFindRich[];
  /** Rich entries for the rolling 12-month window. */
  yearly: readonly TopFindRich[];
  /** Rich entries for the rolling 30-day window (the most recent
   *  third tab). Lets visitors see who's trending RIGHT NOW without
   *  the all-time leaderboard's heavy bias toward long-standing
   *  favourites. */
  monthly: readonly TopFindRich[];
}

/**
 * Bottom-of-/statistiky leaderboard with two views (All-time / Last 12
 * months) on a single tab control. Server pre-fetches both lists (the
 * queries are cheap thanks to the `vote_count` index + groupBy on
 * `voted_at`), so the tab switch is a pure client-side state change
 * with no network round-trip.
 *
 * Anonymized finds intentionally render their thumbnail — per the
 * product decision "voting is about the image, not the location",
 * they're allowed in the leaderboard. We strip identifying location
 * info from the link, though — the deep-link goes to the find detail
 * which already gates the anonymized stub.
 */
export function TopFindsLeaderboard({ allTime, yearly, monthly }: Props) {
  const t = useTranslations("Popular");
  const [active, setActive] = useState<"all" | "year" | "month">("all");
  const entries =
    active === "all" ? allTime : active === "year" ? yearly : monthly;

  return (
    <section
      aria-labelledby="leaderboard-heading"
      className="rounded-xl border border-gray-200 bg-white p-5"
    >
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="leaderboard-heading"
            className="flex items-center gap-2 text-lg font-semibold text-gray-900"
          >
            <Trophy className="h-5 w-5 text-amber-500" aria-hidden />
            {t("leaderboardHeading")}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {t("leaderboardSubtitle")}
          </p>
        </div>
        <div
          role="tablist"
          aria-label={t("leaderboardHeading")}
          className="flex items-center gap-1 rounded-md border border-gray-300 bg-gray-50 p-1 text-xs"
        >
          <TabButton
            label={t("tabAllTime")}
            active={active === "all"}
            onClick={() => setActive("all")}
          />
          <TabButton
            label={t("tabYear")}
            active={active === "year"}
            onClick={() => setActive("year")}
          />
          <TabButton
            label={t("tabMonth")}
            active={active === "month"}
            onClick={() => setActive("month")}
          />
        </div>
      </header>

      {entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          {t("leaderboardEmpty")}
        </p>
      ) : (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {entries.map((e, idx) => (
            <li
              key={e.findId}
              className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50 transition hover:border-brand-300 hover:shadow-sm"
            >
              {/* Photo + rank badge link to the find detail; the vote
               *  button below is its own affordance so visitors can
               *  boost a top entry without leaving the page. Two
               *  separate clickable surfaces, no nested <a><button>
               *  HTML invariant. */}
              <Link
                href={`/sbirka/${e.findId}`}
                className="group relative block"
                aria-label={t("openFind")}
              >
                {e.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={e.thumbUrl}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    decoding="async"
                    className="aspect-square w-full object-cover transition-transform group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-gray-100 text-gray-400">
                    <Trophy className="h-8 w-8" aria-hidden />
                  </div>
                )}
                <span
                  aria-hidden
                  className="absolute left-2 top-2 inline-flex items-center rounded-md bg-white/90 px-1.5 py-0.5 text-xs font-bold text-brand-700 shadow-sm backdrop-blur-sm"
                >
                  {t("rankPrefix")}
                  {idx + 1}
                </span>
              </Link>
              <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                <Link
                  href={`/sbirka/${e.findId}`}
                  className="font-mono text-gray-700 hover:underline"
                >
                  #{e.findId}
                </Link>
                {/* autoHydrate so the per-visitor voted state lands
                 *  even though /statistiky is ISR-cached and can't
                 *  read cookies during the cached render. The button
                 *  starts with the public count, then GET fixes it
                 *  on mount. Switching tabs unmounts → remounts via
                 *  the parent's conditional render, so each tab gets
                 *  its own fresh hydration. */}
                <VoteButton
                  findId={e.findId}
                  initialVoted={false}
                  initialCount={e.voteCount}
                  compact
                  autoHydrate
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded px-2.5 py-1 font-medium transition ${
        active
          ? "bg-white text-brand-700 shadow-sm"
          : "text-gray-600 hover:text-gray-900"
      }`}
    >
      {label}
    </button>
  );
}
