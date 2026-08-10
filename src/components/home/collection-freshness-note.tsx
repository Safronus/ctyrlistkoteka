import { getTranslations } from "next-intl/server";

/**
 * Collection freshness line in the site-wide footer: when the collection
 * last grew, and by how much.
 *
 * It used to hide two more dates behind an ⓘ toggle — the founding date
 * and the last historic-backfill upload. Both were answers to questions
 * that stopped being open: the backfill finished (there are no missing
 * clovers left to fill in), which left a permanent line reporting the
 * last of something that will not happen again. So the toggle, the
 * client bundle it needed, and the second DB query behind it are gone.
 *
 * The date arrives pre-formatted from the server — `formatShortDateTimeCs`
 * is not timezone-pinned, so formatting it client-side would risk a
 * hydration mismatch.
 */
export async function CollectionFreshnessNote({
  lastUpdated,
  latestCount,
}: {
  lastUpdated: string | null;
  latestCount: number;
}) {
  if (!lastUpdated) return null;
  const t = await getTranslations("Home");

  return (
    <div className="mt-2 text-center text-xs text-gray-600">
      <p>
        {t("lastUpdated")} <span className="text-gray-500">{lastUpdated}</span>
        {latestCount > 0 && (
          <span className="text-gray-500">
            {" "}
            ({t("lastBackfillCount", { count: latestCount })})
          </span>
        )}
      </p>
    </div>
  );
}
