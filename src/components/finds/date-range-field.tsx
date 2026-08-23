"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

/**
 * One end of the /sbirka date range.
 *
 * Replaces `<input type="date">`, for the two reasons its own behaviour
 * could not be talked out of. It reported a change the moment its three
 * parts formed a valid date, so typing 15. 3. 2019 filtered on the year
 * 0002 first and pulled the page away mid-keystroke. And its calendar
 * walks one month at a time — reaching 2019 from today is dozens of
 * clicks, with no way to jump a year.
 *
 * So: the text is local until Enter or blur, and the calendar's heading is
 * a button that swaps the day grid for a grid of years. The collection's
 * own span bounds everything, so there is never a year to page to that
 * holds nothing.
 */

const CELL =
  "flex h-8 w-8 items-center justify-center rounded-md text-sm transition";

export interface DateRangeFieldProps {
  ariaLabel: string;
  openLabel: string;
  todayLabel: string;
  clearLabel: string;
  monthLabel: string;
  yearLabel: string;
  /** ISO `YYYY-MM-DD`, or "" for an unset end. */
  value: string;
  /** Bounds of the collection — nothing outside them is selectable. */
  min: string | null;
  max: string | null;
  /** Today, already anchored to the collection's timezone by the caller. */
  today: string;
  locale: string;
  onCommit: (value: string) => void;
  inputClassName: string;
}

export function DateRangeField({
  ariaLabel,
  openLabel,
  todayLabel,
  clearLabel,
  monthLabel,
  yearLabel,
  value,
  min,
  max,
  today,
  locale,
  onCommit,
  inputClassName,
}: DateRangeFieldProps) {
  const [draft, setDraft] = useState(() => toDisplay(value, locale));
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // The URL is the truth: a filter cleared elsewhere, or the back button,
  // has to show here — but never while the field is being typed into.
  const display = toDisplay(value, locale);
  if (!editing && draft !== display) setDraft(display);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const commitText = (text: string) => {
    setEditing(false);
    const iso = parseTyped(text);
    // Unparseable input snaps back rather than filtering on a guess.
    if (iso === null) {
      setDraft(display);
      return;
    }
    const clamped = clamp(iso, min, max);
    if (clamped !== value) onCommit(clamped);
    else setDraft(toDisplay(value, locale));
  };

  return (
    <div ref={wrapRef} className="relative inline-flex items-center gap-0.5">
      <input
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel}
        value={draft}
        placeholder={placeholderFor(locale)}
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={(e) => commitText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitText(e.currentTarget.value);
          } else if (e.key === "Escape") {
            setDraft(display);
            setEditing(false);
          }
        }}
        className={`${inputClassName} w-[7.5rem] tabular-nums`}
      />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={openLabel}
        aria-label={openLabel}
        aria-expanded={open}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-500 transition hover:border-gray-400 hover:bg-gray-50 hover:text-gray-700"
      >
        <CalendarDays className="h-3.5 w-3.5" aria-hidden />
      </button>

      {open && (
        <Calendar
          value={value}
          min={min}
          max={max}
          today={today}
          locale={locale}
          monthLabel={monthLabel}
          yearLabel={yearLabel}
          todayLabel={todayLabel}
          clearLabel={clearLabel}
          onPick={(iso) => {
            setOpen(false);
            setEditing(false);
            if (iso !== value) onCommit(iso);
          }}
        />
      )}
    </div>
  );
}

/** The popup: a month of days, or — one click on the heading — a grid of
 *  years, which is the whole point of not using the native picker. */
function Calendar({
  value,
  min,
  max,
  today,
  locale,
  monthLabel,
  yearLabel,
  todayLabel,
  clearLabel,
  onPick,
}: {
  value: string;
  min: string | null;
  max: string | null;
  today: string;
  locale: string;
  monthLabel: string;
  yearLabel: string;
  todayLabel: string;
  clearLabel: string;
  onPick: (iso: string) => void;
}) {
  const anchor = value || clamp(today, min, max);
  const [cursor, setCursor] = useState(() => ({
    year: Number(anchor.slice(0, 4)),
    month: Number(anchor.slice(5, 7)) - 1,
  }));
  const [pickingYear, setPickingYear] = useState(false);

  const minYear = min ? Number(min.slice(0, 4)) : cursor.year - 5;
  const maxYear = max ? Number(max.slice(0, 4)) : cursor.year + 5;

  const monthName = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "cs-CZ", {
        month: "long",
      }).format(new Date(Date.UTC(cursor.year, cursor.month, 1))),
    [cursor, locale],
  );

  // Monday-first, like every Czech calendar.
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "cs-CZ", {
      weekday: "short",
    });
    return Array.from({ length: 7 }, (_, i) =>
      fmt.format(new Date(Date.UTC(2024, 0, 1 + i))),
    );
  }, [locale]);

  const days = useMemo(() => {
    const first = new Date(Date.UTC(cursor.year, cursor.month, 1));
    const lead = (first.getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate();
    const cells: Array<string | null> = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= count; d++) {
      cells.push(
        `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      );
    }
    return cells;
  }, [cursor]);

  const step = (delta: number) => {
    const m = cursor.month + delta;
    setCursor({
      year: cursor.year + Math.floor(m / 12),
      month: ((m % 12) + 12) % 12,
    });
  };

  return (
    <div className="absolute right-0 top-9 z-30 w-[17rem] rounded-lg border border-gray-200 bg-white p-2 shadow-xl">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => (pickingYear ? setCursor({ ...cursor, year: cursor.year - 12 }) : step(-1))}
          aria-label={monthLabel}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setPickingYear((p) => !p)}
          aria-label={yearLabel}
          className="flex-1 rounded-md px-2 py-1 text-sm font-semibold text-gray-900 transition hover:bg-gray-100"
        >
          {pickingYear ? yearLabel : `${monthName} ${cursor.year}`}
        </button>
        <button
          type="button"
          onClick={() => (pickingYear ? setCursor({ ...cursor, year: cursor.year + 12 }) : step(1))}
          aria-label={monthLabel}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {pickingYear ? (
        <ul className="mt-2 grid grid-cols-3 gap-1">
          {yearsAround(cursor.year, minYear, maxYear).map((y) => (
            <li key={y}>
              <button
                type="button"
                onClick={() => {
                  setCursor({ ...cursor, year: y });
                  setPickingYear(false);
                }}
                className={`w-full rounded-md px-2 py-1.5 text-sm tabular-nums transition ${
                  y === Number((value || anchor).slice(0, 4))
                    ? "bg-brand-600 text-white"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {y}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-7 gap-0.5 text-center text-[11px] text-gray-400">
            {weekdays.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="mt-0.5 grid grid-cols-7 gap-0.5">
            {days.map((iso, i) => {
              if (!iso) return <span key={`x${i}`} />;
              const disabled =
                (min !== null && iso < min) || (max !== null && iso > max);
              const selected = iso === value;
              const isToday = iso === today;
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(iso)}
                  className={`${CELL} tabular-nums ${
                    selected
                      ? "bg-brand-600 font-semibold text-white"
                      : disabled
                        ? "cursor-not-allowed text-gray-300"
                        : isToday
                          ? "font-semibold text-brand-700 ring-1 ring-brand-300 hover:bg-brand-50"
                          : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {Number(iso.slice(8))}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
        <button
          type="button"
          onClick={() => onPick(clamp(today, min, max))}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-50"
        >
          <CalendarCheck className="h-3.5 w-3.5" aria-hidden />
          {todayLabel}
        </button>
        <button
          type="button"
          onClick={() => onPick("")}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-100"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          {clearLabel}
        </button>
      </div>
    </div>
  );
}

/** Twelve years around the cursor, clipped to the collection's span. */
function yearsAround(year: number, min: number, max: number): number[] {
  const start = Math.max(min, Math.min(year - 5, max - 11));
  const out: number[] = [];
  for (let y = start; y < start + 12 && y <= max; y++) out.push(y);
  return out.length > 0 ? out : [year];
}

/** ISO → what the reader types: `14.06.2021` in Czech, `2021-06-14` in EN. */
function toDisplay(iso: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  if (locale === "en") return iso;
  return `${iso.slice(8)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

/**
 * What the reader typed → ISO, or null when it is not a date yet.
 *
 * Deliberately forgiving about separators and leading zeros — `1.3.2019`,
 * `01. 03. 2019` and `2019-03-01` all mean the same day — because the
 * whole point of this field is that a typed date is not judged until it
 * is finished.
 */
function parseTyped(text: string): string | null {
  const s = text.trim();
  if (s === "") return "";
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const cs = /^(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{4})$/.exec(s);
  const [y, m, d] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : cs
      ? [Number(cs[3]), Number(cs[2]), Number(cs[1])]
      : [0, 0, 0];
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Reject a day the month does not have (31 February) rather than let
  // Date roll it over into March.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function placeholderFor(locale: string): string {
  return locale === "en" ? "yyyy-mm-dd" : "d. m. rrrr";
}

/** Keeps a date inside the collection's own span. */
function clamp(iso: string, min: string | null, max: string | null): string {
  if (!iso) return iso;
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}
