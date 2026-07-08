import { getTranslations } from "next-intl/server";
import type { PublicFind } from "@/lib/queries/finds";
import { FindCard } from "./find-card";

export async function FindGrid({
  finds,
  votedSet,
  voteCounts,
  className = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4",
  priority = true,
  autoHydrate = false,
}: {
  finds: readonly PublicFind[];
  /** See FindList for the contract — same shape, just consumed by
   *  the grid card variant instead of the list row. */
  votedSet?: ReadonlySet<number>;
  voteCounts?: ReadonlyMap<number, number>;
  /** Forwarded to each card's VoteButton: when the host page is
   *  ISR-cached (can't read the visitor's cookie at render time), the
   *  buttons self-hydrate their voted state on mount. Leave false on
   *  dynamic pages like /sbirka that already pass an accurate votedSet. */
  autoHydrate?: boolean;
  /** Tailwind grid classes for the wrapping `<ul>`. Defaults to the
   *  /sbirka 2/3/4-column layout; the location detail page passes a
   *  3-column variant for its "recent finds" block. */
  className?: string;
  /** Eager-load the first row's thumbnails (fixes the /sbirka LCP). Pass
   *  false where the grid is below the fold (e.g. the detail page) so it
   *  doesn't compete with that page's real LCP image. */
  priority?: boolean;
}) {
  if (finds.length === 0) {
    const t = await getTranslations("Sbirka");
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-12 text-center">
        <p className="text-gray-500">{t("noFindsMatch")}</p>
      </div>
    );
  }

  return (
    <ul className={className}>
      {finds.map((find, i) => (
        <li key={find.id}>
          <FindCard
            find={find}
            voted={votedSet?.has(find.id) ?? false}
            voteCount={voteCounts?.get(find.id) ?? 0}
            autoHydrate={autoHydrate}
            // First row (up to 4 cols on lg) is above the fold — eager-load
            // it so the LCP thumbnail isn't lazy. Rest stay lazy.
            priority={priority && i < 4}
          />
        </li>
      ))}
    </ul>
  );
}
