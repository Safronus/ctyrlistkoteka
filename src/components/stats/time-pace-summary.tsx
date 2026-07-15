import { getTranslations } from "next-intl/server";
import { formatLongDuration } from "@/lib/format";
import type { StatsTimeAndPaceResult } from "@/lib/queries/stats";

type StatsT = Awaited<ReturnType<typeof getTranslations<"Statistiky">>>;

function toIntlLocale(locale: string): string {
  if (locale === "cs") return "cs-CZ";
  if (locale === "en") return "en-GB";
  return locale;
}

/**
 * "Odhadovaná doba sbírání" + all-time pace — the top half of the
 * /statistiky Time & Pace card, factored out so the home page can show the
 * same panel above its highlights row. Deliberately excludes the per-year
 * breakdown (YearlyPaceBlock), which stays /statistiky-only.
 */
export function TimePaceSummary({
  data,
  t,
  locale,
}: {
  data: StatsTimeAndPaceResult;
  t: StatsT;
  locale: string;
}) {
  const intlLocale = toIntlLocale(locale);
  const fmtPace = new Intl.NumberFormat(intlLocale, {
    maximumFractionDigits: 1,
  });
  const dateFmt = new Intl.DateTimeFormat(intlLocale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const totalLabel = formatLongDuration(data.estimatedMinutes, locale);
  const firstAtLabel = data.firstFoundAt
    ? dateFmt.format(new Date(data.firstFoundAt))
    : null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="flex flex-col items-center justify-center text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-700">
          {t("timePaceEstimate")}
        </p>
        <p className="mt-1 text-3xl font-bold text-brand-700">{totalLabel}</p>
        <p
          className="mt-1 max-w-xs text-xs text-gray-500"
          title={t("timePaceTitle")}
        >
          {t("timePaceSummary", { sessions: data.sessions })}
          {data.locationCount > 0 && (
            <> {t("timePaceSummaryAt", { count: data.locationCount })}</>
          )}
          {/* The "(Ø … 🍀 / hledání) + baseline" qualifier moves onto its own
              line so the sentence doesn't run long. */}
          <span className="block">
            {data.findsPerSession > 0 && (
              <>
                {t("timePaceAvgPerSession", {
                  avg: fmtPace.format(data.findsPerSession),
                })}{" "}
              </>
            )}
            {t("timePaceBaseline")}
          </span>
        </p>
      </div>

      <div className="flex flex-col">
        <p className="text-center text-xs font-medium uppercase tracking-wide text-brand-700">
          {t("paceAllTime")}
        </p>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <PaceCell label={t("perHour")} value={fmtPace.format(data.perHour)} />
          <PaceCell label={t("perDay")} value={fmtPace.format(data.perDay)} />
          <PaceCell label={t("perWeek")} value={fmtPace.format(data.perWeek)} />
          <PaceCell
            label={t("perMonth")}
            value={fmtPace.format(data.perMonth)}
          />
          <PaceCell
            label={t("perYearLabel")}
            value={fmtPace.format(data.perYear)}
          />
        </ul>
        {firstAtLabel && (
          <p className="mt-3 text-center text-xs text-gray-500">
            {t("sinceFirstFind", { date: firstAtLabel })}
          </p>
        )}
      </div>
    </div>
  );
}

function PaceCell({ label, value }: { label: string; value: string }) {
  return (
    <li className="rounded-md border border-gray-200 bg-gray-50 p-2 text-center">
      <p className="font-mono text-sm font-semibold tabular-nums text-gray-900">
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-gray-500">{label}</p>
    </li>
  );
}
