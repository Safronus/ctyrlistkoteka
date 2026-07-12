import { getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import {
  ABUSEIPDB_CONTRIBUTOR_URL,
  getAbuseReport,
} from "@/lib/abuseipdbBadge";

/** Shared shield icon + "AbuseIPDB" link. The count is optional so the same
 *  markup serves the Suspense fallback (link only) and the resolved badge. */
async function BadgeShell({ children }: { children?: React.ReactNode }) {
  const t = await getTranslations("Footer");
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
      {children}
    </span>
  );
}

/** Footer badge crediting the site's AbuseIPDB contributions. Fetches the
 *  reported-IP count server-side (cached, no visitor data leaves) and shows it
 *  as local text. Wrap in <Suspense fallback={<AbuseIpdbBadgeFallback />}> so
 *  a cold/slow fetch never blocks page render — the link shows immediately and
 *  the number streams in. */
export async function AbuseIpdbBadge() {
  const [t, report] = await Promise.all([
    getTranslations("Footer"),
    getAbuseReport(),
  ]);
  return (
    <span data-abuse-debug={report.note}>
      <BadgeShell>
        {report.count !== null && (
          <>
            <span aria-hidden>·</span>
            <span title={t("abuseipdbTitle")}>
              {t("abuseipdbCount", { count: report.count })}
            </span>
          </>
        )}
      </BadgeShell>
    </span>
  );
}

/** Link-only placeholder shown while the count resolves. */
export function AbuseIpdbBadgeFallback() {
  return <BadgeShell />;
}
