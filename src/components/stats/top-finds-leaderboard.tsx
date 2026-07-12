"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Clock, Heart, Trophy } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { VoteButton } from "@/components/finds/vote-button";
import { CollapsibleSection } from "@/components/stats/collapsible-section";
import { formatTinyDateTimeCs } from "@/lib/format";
import type { TopFindRich } from "@/lib/votes";

/** Vote timestamps render in a Client Component, so pin the zone to the
 *  collection's wall clock — otherwise SSR (server zone) and the browser
 *  disagree and React reports a hydration mismatch. */
const COLLECTION_TZ = "Europe/Prague";

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
  const locale = useLocale();
  const [active, setActive] = useState<"all" | "year" | "month">("all");
  const entries =
    active === "all" ? allTime : active === "year" ? yearly : monthly;
  // Windowed tabs rank by period votes — show "period / all-time" so a low
  // all-time entry that's trending still reads sensibly.
  const isPeriod = active !== "all";

  return (
    <CollapsibleSection
      storageKey="topFinds"
      id="top-finds"
      title={
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <Trophy className="h-5 w-5 text-amber-500" aria-hidden />
          {t("leaderboardHeading")}
        </h2>
      }
      subtitle={t("leaderboardSubtitle")}
    >
      <div className="mb-3 flex justify-end">
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
      </div>

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
                {/* Top-right "Darovaný" badge — surfaced when the
                    find carries DONATED state. Sibling to the rank
                    chip so both sit on the photo. Heart icon +
                    rose tint matches the jubilee tile variant so
                    the two surfaces feel like the same family. */}
                {e.isDonated && (
                  <span
                    className="absolute right-2 top-2 inline-flex items-center gap-0.5 rounded-md bg-rose-100/95 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-800 shadow-sm backdrop-blur-sm"
                    aria-label={t("donatedBadge")}
                    title={t("donatedBadge")}
                  >
                    <Heart className="h-2.5 w-2.5" aria-hidden />
                    {t("donatedBadge")}
                  </span>
                )}
              </Link>
              <div className="flex items-center justify-between gap-2 px-2 pt-1.5 text-xs">
                <Link
                  href={`/sbirka/${e.findId}`}
                  className="font-mono text-gray-700 hover:underline"
                >
                  #{e.findId}
                </Link>
                {/* Count is always the ALL-TIME total (that's what a vote
                 *  changes) — passing it here avoids the period→total flip on
                 *  autoHydrate in the windowed tabs. autoHydrate then lands
                 *  the per-visitor voted state (ISR render can't read cookies);
                 *  tab switch remounts so each gets a fresh hydration. */}
                <VoteButton
                  findId={e.findId}
                  initialVoted={false}
                  initialCount={e.totalVoteCount}
                  compact
                  autoHydrate
                />
              </div>
              {/* Caption: window/all-time ratio (windowed tabs only) + when
                  the most recent vote landed (all tabs). */}
              <div className="space-y-0.5 px-2 pb-1.5 pt-0.5 text-[10px] leading-tight text-gray-500">
                {isPeriod && (
                  <div title={t("leaderboardPeriodRatioTitle")}>
                    <span className="font-semibold text-gray-700">
                      {e.voteCount}
                    </span>{" "}
                    / {e.totalVoteCount} {t("votesShort")}
                  </div>
                )}
                {e.lastVotedAt && (
                  <div
                    className="inline-flex items-center gap-1"
                    title={t("leaderboardLastVoteTitle")}
                  >
                    <Clock className="h-2.5 w-2.5 shrink-0" aria-hidden />
                    <span>
                      {formatTinyDateTimeCs(
                        new Date(e.lastVotedAt),
                        locale,
                        COLLECTION_TZ,
                      )}
                    </span>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </CollapsibleSection>
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
