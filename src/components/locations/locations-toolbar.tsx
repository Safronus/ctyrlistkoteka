"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Archive, ArrowUpDown, Camera, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import type { LocationSort } from "@/lib/queries/locations";

// Sort labels live in i18n; the dropdown carries just the value + key.
// Icons used to live on per-toggle buttons but the dropdown collapsed
// the 6 buttons into one — the leading ArrowUpDown icon stands for
// "řazení" generically rather than the active mode.
const SORT_KEYS: ReadonlyArray<{
  value: LocationSort;
  key: string;
}> = [
  { value: "finds", key: "sortFinds" },
  { value: "id", key: "sortId" },
  { value: "newest", key: "sortNewest" },
  { value: "code", key: "sortCode" },
  { value: "dist-asc", key: "sortDistAsc" },
  { value: "dist-desc", key: "sortDistDesc" },
];

export function LocationsToolbar({
  current,
  anonymizedCount,
  formerCount,
}: {
  current: {
    sort: LocationSort;
    showAnonymized: boolean;
    showGone: boolean;
    hasRealPhoto: boolean;
    hasFilters: boolean;
  };
  /** Total locations the "Anonymizované" toggle would reveal when
   *  switched on — surfaced in the button label so the visitor sees
   *  the size of the pool before flipping it. Counts EVERY
   *  anonymized location regardless of the other filters. */
  anonymizedCount: number;
  /** Same idea for the "Zaniklé" toggle — count of NEEXISTUJE-
   *  prefixed locations across the whole catalog. */
  formerCount: number;
}) {
  const t = useTranslations("LocationsToolbar");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const update = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const toggleFlag = (
    key: "showAnon" | "showGone" | "hasPhoto",
    on: boolean,
  ) => {
    update(key, on ? "1" : "");
  };

  const clearAll = () => {
    startTransition(() => {
      router.push(pathname);
    });
  };

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 transition-opacity ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ToggleButton
          pressed={current.showAnonymized}
          onClick={() => toggleFlag("showAnon", !current.showAnonymized)}
          icon={<EyeOff className="h-4 w-4" />}
          label={t("anonymized")}
          count={anonymizedCount}
        />
        <ToggleButton
          pressed={current.showGone}
          onClick={() => toggleFlag("showGone", !current.showGone)}
          icon={<Archive className="h-4 w-4" />}
          label={t("gone")}
          count={formerCount}
        />
        <ToggleButton
          pressed={current.hasRealPhoto}
          onClick={() => toggleFlag("hasPhoto", !current.hasRealPhoto)}
          icon={<Camera className="h-4 w-4" />}
          label={t("hasRealPhoto")}
        />
        {current.hasFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="ml-1 text-sm text-brand-700 hover:underline"
          >
            {t("clearFilters")}
          </button>
        )}
      </div>

      {/* Sort: single dropdown instead of a 6-button group. Native
          <select> keeps the toolbar compact and gets keyboard + mobile
          OS-styled affordances for free. "finds" maps to no URL param
          (it's the default), so picking it clears the param rather
          than setting `?sort=finds`. */}
      <label
        className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-2.5 text-sm text-gray-700"
        aria-label={t("sortAria")}
      >
        <ArrowUpDown
          className="h-4 w-4 shrink-0 text-gray-500"
          aria-hidden
        />
        <span className="hidden text-gray-500 sm:inline">
          {t("sortLabel")}:
        </span>
        <select
          value={current.sort}
          onChange={(e) =>
            update("sort", e.target.value === "finds" ? "" : e.target.value)
          }
          className="cursor-pointer border-0 bg-transparent pr-1 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        >
          {SORT_KEYS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.key)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ToggleButton({
  pressed,
  onClick,
  icon,
  label,
  count,
}: {
  pressed: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  /** Optional integer rendered as `(N)` after the label. Used on the
   *  Anonymizované + Zaniklé toggles to show the size of the pool
   *  the toggle would reveal. Omit (or pass 0) to skip the chip. */
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm transition ${
        pressed
          ? "border-brand-600 bg-brand-600 text-white shadow-sm"
          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
      }`}
    >
      {icon}
      <span>{label}</span>
      {typeof count === "number" && count > 0 && (
        <span
          className={`font-mono tabular-nums text-xs ${
            pressed ? "text-white/80" : "text-gray-500"
          }`}
        >
          ({count})
        </span>
      )}
    </button>
  );
}
