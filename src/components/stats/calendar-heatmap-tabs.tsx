"use client";

import { Calendar, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { MinuteHeatmapCell } from "@/lib/queries/stats";
import { MinuteHeatmap } from "./minute-heatmap";

type Tab = "days" | "minutes";

/** Wraps the existing month×day heatmap (passed in pre-rendered as
 *  `daysView`) and a new minute heatmap into one tab UI, so both views
 *  share the same screen real estate inside the calendar stats section.
 *
 *  The Days view is server-rendered HTML; we render it eagerly because
 *  the cost is negligible and it lets the page hydrate without an
 *  intermediate blank. The Minutes view mounts its Canvas only when
 *  the Minutes tab becomes active (conditional render), so the heavier
 *  buckets-rebuild + paint pass is deferred until the user opts in. */
export function CalendarHeatmapTabs({
  daysView,
  minuteCells,
}: {
  daysView: React.ReactNode;
  minuteCells: readonly MinuteHeatmapCell[];
}) {
  const t = useTranslations("Statistiky");
  const [active, setActive] = useState<Tab>("days");

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label={t("heatmapTabsAriaLabel")}
        className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5"
      >
        <TabButton
          active={active === "days"}
          onClick={() => setActive("days")}
          icon={<Calendar className="h-3.5 w-3.5" aria-hidden />}
          label={t("heatmapTabDays")}
        />
        <TabButton
          active={active === "minutes"}
          onClick={() => setActive("minutes")}
          icon={<Clock className="h-3.5 w-3.5" aria-hidden />}
          label={t("heatmapTabMinutes")}
        />
      </div>

      {active === "days" ? (
        <div role="tabpanel">{daysView}</div>
      ) : (
        <div role="tabpanel" className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            {t("minuteHeatmapHeading")}
          </h3>
          <p className="mb-3 text-xs text-gray-500">
            {t("minuteHeatmapSubtitle")}
          </p>
          <MinuteHeatmap cells={minuteCells} />
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "bg-white text-brand-700 shadow-sm"
          : "text-gray-600 hover:text-gray-900"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
