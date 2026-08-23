"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowUpDown,
  CalendarCheck,
  Camera,
  EyeOff,
  LayoutGrid,
  List,
} from "lucide-react";
import type { FindSort } from "@/lib/queries/finds";

export type FindView = "grid" | "list";

const DATE_INPUT_CLS =
  "h-8 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 transition hover:border-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";

export function ViewSortToolbar({
  view,
  defaultView,
  sort,
  dateFrom,
  dateTo,
  minDate,
  maxDate,
  hasPhoto,
  hasPhotoCount,
  hideDominant,
  hideDominantCount,
  dominantLocationCode,
}: {
  view: FindView;
  /** Device default (grid on phones, list otherwise), resolved server-side
   *  from the UA. Used as the "clean URL" value: switching back to it drops
   *  the `?view=` param instead of pinning it. */
  defaultView: FindView;
  sort: FindSort;
  /** YYYY-MM-DD or empty. Native `<input type="date">` value shape. */
  dateFrom: string;
  dateTo: string;
  /** Earliest/latest find date in the collection — used as both the
   *  default placeholder values and the picker `min`/`max` bounds.
   *  Null when the collection has no dated finds yet. */
  minDate: string | null;
  maxDate: string | null;
  /** "S fotkou daru" toggle — sits between the view switch and the
   *  date range so it reads as a quick-narrow filter alongside dates,
   *  not buried in the FilterBar dropdown stack. URL param: hasPhoto=1. */
  hasPhoto: boolean;
  /** Total finds that carry a donation photo (filter-independent) —
   *  rendered as `(N)` after the toggle label so the visitor sees
   *  the pool size before flipping it. */
  hasPhotoCount: number;
  /** "Skrýt největší lokalitu" toggle — drops finds whose location is
   *  the configured `DOMINANT_LOCATION_ID` (or any of its child
   *  locations) so the user can browse the rest of the collection
   *  without paging past thousands of rows from a single dense
   *  patch. URL param: `hideTop=1`. */
  hideDominant: boolean;
  /** Number of finds the "Skrýt největší lokalitu" toggle would
   *  hide (dominant location + its direct children). Rendered as
   *  `(N)` after the label. */
  hideDominantCount: number;
  /** Display code of the dominant location — used as the toggle's
   *  hover title so it's clear *which* location gets hidden. `null`
   *  hides the toggle entirely (configured location id doesn't
   *  resolve, e.g. fresh DB). */
  dominantLocationCode: string | null;
}) {
  const t = useTranslations("ViewSortToolbar");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  /**
   * Writes one filter into the URL.
   *
   * A value equal to the default drops the parameter, so shared links stay
   * clean. That has one trap, and the view switch fell into it: the page
   * also remembers a choice in a cookie, so what is RENDERED can differ
   * from the default while the URL carries no parameter at all. Clicking
   * the default value then produced the very same URL, `router.push`
   * treated it as no navigation, and nothing happened — until a manual
   * reload, when the server read the new cookie. Hence the compare: an
   * unchanged query means asking the server to render again, not pushing.
   */
  const setParam = (key: string, value: string, defaultValue: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === defaultValue) params.delete(key);
    else params.set(key, value);
    params.delete("page");
    const next = params.toString();
    const current = new URLSearchParams(searchParams.toString());
    current.delete("page");
    startTransition(() => {
      if (next === current.toString()) router.refresh();
      else router.push(next ? `${pathname}?${next}` : pathname);
    });
  };

  /** Today's date in Europe/Prague as the `YYYY-MM-DD` string
   *  `<input type="date">` expects. `en-CA` is the canonical locale
   *  that emits ISO-style dates regardless of the user's browser
   *  language; the `Europe/Prague` timezone keeps "today" anchored
   *  to local CE time so a midnight click in Asia still files
   *  yesterday's CZ-day finds, matching the rest of the project
   *  (sync's `foundAt`, the anniversary overlay, all CE-anchored). */
  const todayInPrague = (): string =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Prague",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

  // Single-row layout: view toggle, sort dropdown, has-photo toggle
  // and date range cluster all sit on one wrappable flex row. With
  // the sort segmented replaced by a compact <select>, the four
  // groups fit side-by-side on a normal desktop (~800 px is plenty)
  // and naturally wrap onto multiple rows when the viewport tightens
  // — phones get them stacked, no media-query branching needed.
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 transition-opacity ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <Segmented
        label={t("view")}
        iconOnly
        value={view}
        options={[
          { value: "grid", label: t("viewGrid"), icon: <LayoutGrid className="h-4 w-4" /> },
          { value: "list", label: t("viewList"), icon: <List className="h-4 w-4" /> },
        ]}
        onChange={(v) => {
          // Remember the choice as a functional cookie (1 year) so the
          // server renders it as the default on the next visit — no flash.
          // Purely a UI preference; disclosed in /soukromi.
          document.cookie = `view=${v}; path=/; max-age=31536000; samesite=lax`;
          setParam("view", v, defaultView);
        }}
      />

      {/* Sort: native <select> dropdown, mirroring /lokality. The
          segmented form had 5 options and overflowed on mobile — the
          OS-rendered dropdown is compact, gets keyboard + mobile
          chrome for free, and matches LocationsToolbar's visual
          language. Label hides under sm: to keep the trigger tight
          on phones. */}
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

      {/* Quick "S fotkou daru" toggle. Visual weight matches the
          Segmented buttons (border + brand-600 bg when active) so
          the row stays uniform. `h-9` matches the sort combobox +
          Segmented so every control in the row is the same height. */}
      <button
        type="button"
        onClick={() => setParam("hasPhoto", hasPhoto ? "" : "1", "")}
        aria-pressed={hasPhoto}
        className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm transition ${
          hasPhoto
            ? "border-brand-600 bg-brand-600 text-white"
            : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
        }`}
      >
        <Camera className="h-4 w-4" aria-hidden />
        <span>{t("hasPhotoToggle")}</span>
        <ToggleCount value={hasPhotoCount} pressed={hasPhoto} />
      </button>

      {/* "Skrýt největší lokalitu" toggle — same visual contract as
          the hasPhoto button so the toolbar stays consistent. Hidden
          when the configured dominant location id doesn't resolve to
          anything in the DB (fresh deploy, wrong constant). Title
          attribute carries the actual location code so a hover
          confirms which location gets dropped. */}
      {dominantLocationCode && (
        <button
          type="button"
          onClick={() => setParam("hideTop", hideDominant ? "" : "1", "")}
          aria-pressed={hideDominant}
          title={t("hideDominantTitle", { code: dominantLocationCode })}
          className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm transition ${
            hideDominant
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          <EyeOff className="h-4 w-4" aria-hidden />
          <span>{t("hideDominantToggle")}</span>
          <ToggleCount value={hideDominantCount} pressed={hideDominant} />
        </button>
      )}

      {/* Date range pushed to the right edge of the row via ml-auto
          so the wide cluster doesn't fight the toggles for space —
          when the viewport tightens, the date group is the first to
          drop to the next line, keeping the four toggles together
          for as long as possible. Bounded to the collection's actual
          span; cross-linked min/max prevent inverted ranges via the
          native UI. */}
      <div
        role="group"
        aria-label={t("dateGroup")}
        className="inline-flex flex-wrap items-center gap-1.5 text-sm text-gray-600 sm:ml-auto"
      >
        <span className="text-xs font-medium uppercase tracking-wide text-brand-700">
          {t("dateLabel")}
        </span>
        <DateField
          ariaLabel={t("dateFrom")}
          yearLabel={t("dateYear")}
          todayLabel={t("dateToday")}
          value={dateFrom || minDate || ""}
          min={minDate || undefined}
          max={dateTo || maxDate || undefined}
          minYear={yearOf(minDate)}
          maxYear={yearOf(maxDate)}
          /** Jumping to a year lands on its FIRST day — "od roku 2019". */
          yearEdge="start"
          onCommit={(v) => setParam("from", v, "")}
          onToday={() => setParam("from", todayInPrague(), "")}
        />
        <span aria-hidden className="text-gray-400">
          –
        </span>
        <DateField
          ariaLabel={t("dateTo")}
          yearLabel={t("dateYear")}
          todayLabel={t("dateToday")}
          value={dateTo || maxDate || ""}
          min={dateFrom || minDate || undefined}
          max={maxDate || undefined}
          minYear={yearOf(minDate)}
          maxYear={yearOf(maxDate)}
          /** …and the upper bound on its LAST day, so "2019" means the
           *  whole year rather than a single January morning. */
          yearEdge="end"
          onCommit={(v) => setParam("to", v, "")}
          onToday={() => setParam("to", todayInPrague(), "")}
        />
      </div>
    </div>
  );
}

/** The year part of an ISO date, as a number — null when there is none. */
function yearOf(iso: string | null): number | null {
  const m = iso ? /^(\d{4})-/.exec(iso) : null;
  return m ? Number(m[1]) : null;
}

/**
 * One end of the date range: a native date input, a year jump and "dnes".
 *
 * Two things it fixes. The input no longer filters WHILE being typed —
 * `<input type="date">` fires a change the moment the three parts form a
 * valid date, so typing 15. 3. 2019 filtered on the year "0002" first and
 * yanked the page away mid-keystroke. The value is now local until the
 * field is left or Enter is pressed; the picker still applies at once,
 * because picking a day IS the decision.
 *
 * And the year dropdown, because the native picker walks months one at a
 * time — reaching 2019 from today is dozens of clicks. It keeps the day
 * and month where sensible and otherwise snaps to the year's edge, so
 * "od 2019" means 1 January and "do 2019" means 31 December.
 */
function DateField({
  ariaLabel,
  yearLabel,
  todayLabel,
  value,
  min,
  max,
  minYear,
  maxYear,
  yearEdge,
  onCommit,
  onToday,
}: {
  ariaLabel: string;
  yearLabel: string;
  todayLabel: string;
  value: string;
  min?: string;
  max?: string;
  minYear: number | null;
  maxYear: number | null;
  yearEdge: "start" | "end";
  onCommit: (value: string) => void;
  onToday: () => void;
}) {
  const [draft, setDraft] = useState(value);
  // The URL is the truth: a filter cleared elsewhere (or the back button)
  // has to show here, and only when the field is not being edited.
  const [editing, setEditing] = useState(false);
  if (!editing && draft !== value) setDraft(value);

  const commit = (v: string) => {
    setEditing(false);
    if (v !== value) onCommit(v);
  };

  const years: number[] = [];
  if (minYear !== null && maxYear !== null) {
    for (let y = maxYear; y >= minYear; y--) years.push(y);
  }
  const currentYear = yearOf(draft);

  return (
    <div className="inline-flex items-center gap-0.5">
      {years.length > 1 && (
        <select
          aria-label={yearLabel}
          title={yearLabel}
          value={currentYear ?? ""}
          onChange={(e) => {
            const y = e.currentTarget.value;
            if (!y) return;
            const next = `${y}-${yearEdge === "start" ? "01-01" : "12-31"}`;
            setDraft(next);
            commit(next);
          }}
          className={`${DATE_INPUT_CLS} cursor-pointer px-1 tabular-nums`}
        >
          {currentYear === null && <option value="">—</option>}
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      )}
      <input
        type="date"
        aria-label={ariaLabel}
        value={draft}
        min={min}
        max={max}
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(e.currentTarget.value);
          } else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className={DATE_INPUT_CLS}
      />
      {/* "Dnes" shortcut: with no value the field falls back to the very
          first find years ago, and reaching today by hand means clicking
          through dozens of months. */}
      <button
        type="button"
        onClick={onToday}
        title={todayLabel}
        aria-label={todayLabel}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-500 transition hover:border-gray-400 hover:bg-gray-50 hover:text-gray-700"
      >
        <CalendarCheck className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** `(N)` count chip appended to a toggle label — monospace, faded so
 *  it reads as metadata, color flips to white-ish when the toggle is
 *  pressed (brand-600 bg). Hidden when value is 0. Mirrors the
 *  LocationsToolbar count chip on /lokality. */
function ToggleCount({
  value,
  pressed,
}: {
  value: number;
  pressed: boolean;
}) {
  if (value <= 0) return null;
  return (
    <span
      className={`font-mono tabular-nums text-xs ${
        pressed ? "text-white/80" : "text-gray-500"
      }`}
    >
      ({value.toLocaleString("cs-CZ")})
    </span>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  iconOnly = false,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; icon: React.ReactNode }>;
  onChange: (v: T) => void;
  /** Render icons only (label moves to title/aria-label) — keeps the
   *  control tight when the labels would just eat horizontal space. */
  iconOnly?: boolean;
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
            title={iconOnly ? opt.label : undefined}
            aria-label={iconOnly ? opt.label : undefined}
            className={`flex h-9 items-center gap-1.5 text-sm transition ${
              iconOnly ? "px-2.5" : "px-3"
            } ${i > 0 ? "border-l border-gray-300" : ""} ${
              active
                ? "bg-brand-600 text-white"
                : "text-gray-700 hover:bg-gray-50"
            }`}
          >
            {opt.icon}
            {!iconOnly && <span>{opt.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
