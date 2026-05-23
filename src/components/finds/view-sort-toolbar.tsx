"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowUpDown,
  Camera,
  LayoutGrid,
  List,
} from "lucide-react";
import type { FindSort } from "@/lib/queries/finds";

export type FindView = "grid" | "list";

const DATE_INPUT_CLS =
  "h-8 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 transition hover:border-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";

export function ViewSortToolbar({
  view,
  sort,
  dateFrom,
  dateTo,
  minDate,
  maxDate,
  hasPhoto,
}: {
  view: FindView;
  sort: FindSort;
  /** YYYY-MM-DD or empty. Native `<input type="date">` value shape. */
  dateFrom: string;
  dateTo: string;
  /** Earliest/latest find date in the collection — used as both the
   *  default placeholder values and the picker `min`/`max` bounds.
   *  Null when the collection has no dated finds yet. */
  minDate: string | null;
  maxDate: string | null;
  /** "S reálnou fotkou" toggle — sits between the view switch and the
   *  date range so it reads as a quick-narrow filter alongside dates,
   *  not buried in the FilterBar dropdown stack. URL param: hasPhoto=1. */
  hasPhoto: boolean;
}) {
  const t = useTranslations("ViewSortToolbar");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const setParam = (key: string, value: string, defaultValue: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === defaultValue) params.delete(key);
    else params.set(key, value);
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  // Layout: two logical rows so the controls don't crash into a
  // wall on desktop and stack predictably on mobile.
  //   Row 1 — display preferences:  View toggle  ·  Sort segmented
  //   Row 2 — quick filters:        S fotkou daru  ·  Date range
  // Each row uses `flex-wrap + justify-between` so the two clusters
  // sit on opposite ends when there's room, and stack vertically when
  // there isn't. Sort has 5 options so on mid-width screens it wraps
  // independently from the view toggle.
  return (
    <div
      className={`flex flex-col gap-3 transition-opacity ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t("view")}
          value={view}
          options={[
            { value: "grid", label: t("viewGrid"), icon: <LayoutGrid className="h-4 w-4" /> },
            { value: "list", label: t("viewList"), icon: <List className="h-4 w-4" /> },
          ]}
          onChange={(v) => setParam("view", v, "list")}
        />

        {/* Sort: native <select> dropdown, mirroring /lokality. The
            segmented form had 5 options and overflowed on mobile —
            the OS-rendered dropdown is compact, gets keyboard +
            mobile chrome for free, and matches LocationsToolbar's
            visual language. Label hides under sm: to keep the
            trigger tight on phones. */}
        <label
          className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-2.5 text-sm text-gray-700"
          aria-label={t("sort")}
        >
          <ArrowUpDown
            className="h-4 w-4 shrink-0 text-gray-500"
            aria-hidden
          />
          <span className="hidden text-gray-500 sm:inline">
            {t("sort")}:
          </span>
          <select
            value={sort}
            onChange={(e) => setParam("sort", e.target.value, "desc")}
            className="cursor-pointer border-0 bg-transparent pr-1 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            <option value="desc">{t("sortDesc")}</option>
            <option value="asc">{t("sortAsc")}</option>
            <option value="dist-asc">{t("sortDistAsc")}</option>
            <option value="dist-desc">{t("sortDistDesc")}</option>
            <option value="votes-desc">{t("sortVotesDesc")}</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Quick "S fotkou daru" toggle — pair with the date range
            on the filter row so all narrow-by-content controls cluster
            below the view/sort preferences. */}
        <button
          type="button"
          onClick={() => setParam("hasPhoto", hasPhoto ? "" : "1", "")}
          aria-pressed={hasPhoto}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition ${
            hasPhoto
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          <Camera className="h-4 w-4" aria-hidden />
          <span>{t("hasPhotoToggle")}</span>
        </button>

        {/* Date range — bounded to the collection's actual span so
            the picker can't produce an out-of-range query, with
            cross-linked min/max preventing inverted ranges via the
            native UI. */}
        <div
          role="group"
          aria-label={t("dateGroup")}
          className="inline-flex flex-wrap items-center gap-1.5 text-sm text-gray-600"
        >
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {t("dateLabel")}
          </span>
          <input
            type="date"
            aria-label={t("dateFrom")}
            value={dateFrom || minDate || ""}
            min={minDate || undefined}
            max={dateTo || maxDate || undefined}
            onChange={(e) => setParam("from", e.currentTarget.value, "")}
            className={DATE_INPUT_CLS}
          />
          <span aria-hidden className="text-gray-400">
            –
          </span>
          <input
            type="date"
            aria-label={t("dateTo")}
            value={dateTo || maxDate || ""}
            min={dateFrom || minDate || undefined}
            max={maxDate || undefined}
            onChange={(e) => setParam("to", e.currentTarget.value, "")}
            className={DATE_INPUT_CLS}
          />
        </div>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; icon: React.ReactNode }>;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-md border border-gray-300 bg-white"
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition ${
              i > 0 ? "border-l border-gray-300" : ""
            } ${
              active
                ? "bg-brand-600 text-white"
                : "text-gray-700 hover:bg-gray-50"
            }`}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
