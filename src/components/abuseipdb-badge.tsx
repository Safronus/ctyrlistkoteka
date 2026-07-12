import { getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import {
  ABUSEIPDB_CONTRIBUTOR_URL,
  getAbuseReportCount,
} from "@/lib/abuseipdbBadge";

/**
 * Footer item crediting the site's AbuseIPDB contributions:
 * "AbuseIPDB · Počet IP reportováno: {N}", linking the contributor profile.
 *
 * Rendered SYNCHRONOUSLY (no Suspense): the site's strict nonce-CSP stops
 * Next's streaming Suspense-reveal from completing, so a boundary here would
 * leave the count stuck hidden. The count is cached (unstable_cache, 6 h) and
 * the fetch is fast, so awaiting it inline just adds ~a few hundred ms to the
 * first cold render; on failure it degrades to the link with no number.
 */
export async function AbuseIpdbBadge() {
  const [t, count] = await Promise.all([
    getTranslations("Footer"),
    getAbuseReportCount(),
  ]);
  return (
    <span className="inline-flex items-center gap-1.5">
      <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden />
      <a
        href={ABUSEIPDB_CONTRIBUTOR_URL}
        target="_blank"
        rel="noopener noreferrer nofollow"
        title={t("abuseipdbTitle")}
        className="font-medium text-gray-700 underline-offset-2 hover:text-brand-700 hover:underline"
      >
        AbuseIPDB
      </a>
      {count !== null && (
        <>
          <span aria-hidden>·</span>
          <span title={t("abuseipdbTitle")}>
            {t("abuseipdbCount", { count })}
          </span>
        </>
      )}
    </span>
  );
}
