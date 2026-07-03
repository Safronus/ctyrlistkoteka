import { getTranslations } from "next-intl/server";
import type { PublicFind } from "@/lib/queries/finds";
import { FindCard } from "./find-card";

export async function FindGrid({
  finds,
  votedSet,
  voteCounts,
}: {
  finds: readonly PublicFind[];
  /** See FindList for the contract — same shape, just consumed by
   *  the grid card variant instead of the list row. */
  votedSet?: ReadonlySet<number>;
  voteCounts?: ReadonlyMap<number, number>;
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
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {finds.map((find, i) => (
        <li key={find.id}>
          <FindCard
            find={find}
            voted={votedSet?.has(find.id) ?? false}
            voteCount={voteCounts?.get(find.id) ?? 0}
            // First row (up to 4 cols on lg) is above the fold — eager-load
            // it so the LCP thumbnail isn't lazy. Rest stay lazy.
            priority={i < 4}
          />
        </li>
      ))}
    </ul>
  );
}
