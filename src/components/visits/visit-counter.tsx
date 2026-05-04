/**
 * Tiny "Návštěv: 1 234" badge rendered in the site footer. Reads the
 * total from the self-hosted GoatCounter via getTotalVisits(); on any
 * failure (network, missing key, malformed response) it falls back to
 * "Návštěv: ???" with a tooltip explaining the outage.
 *
 * Server component — the fetch call is cached at the Next.js layer
 * (10 min TTL) so renders stay cheap regardless of pageload volume.
 */
import { getLocale, getTranslations } from "next-intl/server";
import { getTotalVisits, VISIT_TRACKING_START } from "@/lib/queries/visits";
import { formatDateCs } from "@/lib/format";

function startedAtLabel(iso: string, locale: string): string {
  // ISO YYYY-MM-DD → Date in UTC noon to avoid TZ-flip edge cases.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return formatDateCs(new Date(Date.UTC(y, m - 1, d, 12)), locale);
}

export async function VisitCounter() {
  const [data, t, locale] = await Promise.all([
    getTotalVisits(),
    getTranslations("Footer"),
    getLocale(),
  ]);
  const numberFormat = new Intl.NumberFormat(
    locale === "cs" ? "cs-CZ" : "en-GB",
  );
  const since = startedAtLabel(VISIT_TRACKING_START, locale);
  if (data) {
    return (
      <span
        title={t("visitsTooltip", { since })}
        className="inline-flex items-center gap-1.5"
      >
        <span>{t("visits")}:</span>
        <span className="font-mono font-medium tabular-nums text-gray-700">
          {numberFormat.format(data.total)}
        </span>
      </span>
    );
  }
  return (
    <span
      title={t("visitsTooltipFail")}
      className="inline-flex items-center gap-1.5"
    >
      <span>{t("visits")}:</span>
      <span className="font-mono text-gray-400">???</span>
    </span>
  );
}
