"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import type { FilterOptions } from "@/lib/queries/finds";
import type { FindState } from "@prisma/client";
import { RETIRED_STATES } from "@/lib/stateLabels";

const INPUT_CLS =
  "h-10 rounded-lg border border-gray-200 bg-white px-3.5 text-sm text-gray-900 shadow-sm transition placeholder:text-gray-400 hover:border-gray-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";
const SELECT_CLS = `${INPUT_CLS} cursor-pointer appearance-none pr-10`;

/** "DUBLIN" → "Dublin", "ÚSTÍ NAD LABEM" → "Ústí Nad Labem". Only the
 *  displayed label is title-cased; the stored value stays the raw
 *  (upper-case) cadastral-area string the filter query matches on. */
function titleCase(s: string): string {
  return s
    .toLocaleLowerCase("cs")
    .replace(
      /(^|[\s\-–/(])(\p{L})/gu,
      (_, sep, ch) => sep + ch.toLocaleUpperCase("cs"),
    );
}

export function FilterBar({
  options,
  current,
}: {
  options: FilterOptions;
  current: {
    q: string;
    locationId: string;
    city: string;
    country: string;
    state: string;
    year: string;
  };
}) {
  const t = useTranslations("FilterBar");
  const tCommon = useTranslations("Common");
  const tStates = useTranslations("States");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // The search box must reflect URL changes that originate OUTSIDE
  // this component (browser back/forward, the "Zrušit filtry" button,
  // deep links). The local `qInput` state is the input's source of
  // truth; an effect resyncs it whenever `current.q` changes
  // externally.
  //
  // Crucially, we MUST NOT resync when the URL change came from our
  // own debounced push — otherwise typing fast drops characters:
  //
  //   t=0–150  user types "REYK"  → qInput="REYK", debounce armed
  //   t=400    debounce fires     → router.push("?q=REYK")
  //   t=405    user types "J"     → qInput="REYKJ", new debounce armed
  //   t=420    URL change settles → current.q="REYK" arrives as prop
  //   t=420    effect runs        → setQInput("REYK"), wipes the "J"
  //   t=425+   user types "AVIK"  → qInput="REYKAVIK" (J swallowed)
  //
  // `lastPushedRef` remembers what we most recently sent to the URL.
  // If the incoming `current.q` matches it, the round-trip is our
  // own and we keep the local in-flight value intact.
  const [qInput, setQInput] = useState(current.q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedRef = useRef<string>(current.q);
  useEffect(() => {
    if (current.q === lastPushedRef.current) return;
    setQInput(current.q);
    lastPushedRef.current = current.q;
  }, [current.q]);
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const update = (key: string, value: string) => {
    if (key === "q") lastPushedRef.current = value;
    updateMany({ [key]: value });
  };

  // Set/clear several filter params in one navigation — used by the
  // cascading country/city/location selects, which must change more than
  // one param atomically (e.g. picking a city also pins its country).
  const updateMany = (entries: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(entries)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page"); // reset pagination on filter change
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const clearAll = () => {
    // Preserve presentation params (view/sort) — they're orthogonal to filters.
    const params = new URLSearchParams();
    const view = searchParams.get("view");
    const sort = searchParams.get("sort");
    if (view) params.set("view", view);
    if (sort) params.set("sort", sort);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  // Sort state options by their localized label so the dropdown reads
  // alphabetically in the user's language (Czech: "Anonymizovaný",
  // "Bez fotky", "Bez GPS", …; English would resort accordingly).
  // Done in a memo on the client side because the upstream `states`
  // list is a static `Object.values(FindState)` from the enum (no
  // locale context on the server when it's built).
  const sortedStates = useMemo(() => {
    return [...options.states]
      .filter((s) => !RETIRED_STATES.has(s as FindState))
      .sort((a, b) =>
        tStates(a as FindState).localeCompare(tStates(b as FindState), "cs"),
      );
  }, [options.states, tStates]);

  // Cascading geo filters. A selected city pins its country (even on a
  // deep-linked URL that only carries `city`), so `effectiveCountry`
  // resolves the country from the city when the country param is absent.
  const effectiveCountry =
    current.country ||
    options.cities.find((c) => c.name === current.city)?.country ||
    "";

  // City dropdown narrows to the (effective) country; location dropdown
  // narrows to both country and city. Everything cascades client-side —
  // the options already carry each location's city + country.
  const visibleCities = useMemo(
    () =>
      effectiveCountry
        ? options.cities.filter((c) => c.country === effectiveCountry)
        : options.cities,
    [options.cities, effectiveCountry],
  );
  const visibleLocations = useMemo(
    () =>
      options.locations.filter(
        (l) =>
          (!effectiveCountry || l.country === effectiveCountry) &&
          (!current.city || l.city === current.city),
      ),
    [options.locations, effectiveCountry, current.city],
  );

  const hasAny =
    current.q ||
    current.locationId ||
    current.city ||
    current.country ||
    current.state ||
    current.year;

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 transition-opacity ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="sm:col-span-2 lg:col-span-2">
          <span className="mb-1 block text-xs font-medium text-gray-700">
            {t("search")}
          </span>
          <input
            type="search"
            value={qInput}
            placeholder={t("searchPlaceholder")}
            className={`${INPUT_CLS} w-full`}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setQInput(v);
              if (debounceRef.current) clearTimeout(debounceRef.current);
              debounceRef.current = setTimeout(() => update("q", v), 250);
            }}
          />
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-gray-700">
            {t("country")}
          </span>
          <div className="relative">
            {/* Locked while a city is selected — the city pins its
                country, so another country can't be chosen. Clear the
                city (below) to unlock it. */}
            <select
              value={effectiveCountry}
              disabled={!!current.city}
              onChange={(e) =>
                // Changing country invalidates city + location.
                updateMany({
                  country: e.currentTarget.value,
                  city: "",
                  loc: "",
                })
              }
              className={`${SELECT_CLS} w-full disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400`}
            >
              <option value="">{tCommon("all")}</option>
              {options.countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
          </div>
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-gray-700">
            {t("city")}
          </span>
          <div className="relative">
            <select
              value={current.city}
              onChange={(e) => {
                const city = e.currentTarget.value;
                if (!city) {
                  updateMany({ city: "", loc: "" });
                } else {
                  // Selecting a city pins its country and clears location.
                  const country =
                    options.cities.find((c) => c.name === city)?.country ??
                    current.country;
                  updateMany({ city, country, loc: "" });
                }
              }}
              className={`${SELECT_CLS} w-full`}
            >
              <option value="">{tCommon("allAlt")}</option>
              {visibleCities.map((c) => (
                <option key={c.name} value={c.name}>
                  {titleCase(c.name)}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
          </div>
        </label>

        <label className="sm:col-span-2 lg:col-span-2">
          <span className="mb-1 block text-xs font-medium text-gray-700">
            {t("location")}
          </span>
          <div className="relative">
            <select
              value={current.locationId}
              onChange={(e) => {
                const loc = e.currentTarget.value;
                const location = options.locations.find(
                  (l) => String(l.id) === loc,
                );
                // Picking a location pins its city + country too, so the
                // three selects stay mutually consistent.
                if (location) {
                  updateMany({
                    loc,
                    city: location.city,
                    country: location.country,
                  });
                } else {
                  updateMany({ loc });
                }
              }}
              className={`${SELECT_CLS} w-full`}
            >
              <option value="">{tCommon("all")}</option>
              {visibleLocations.map((l) => (
                <option key={l.id} value={String(l.id)}>
                  {l.label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
          </div>
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-gray-700">
            {t("state")}
          </span>
          <div className="relative">
            <select
              value={current.state}
              onChange={(e) => update("state", e.currentTarget.value)}
              className={`${SELECT_CLS} w-full`}
            >
              <option value="">{tCommon("all")}</option>
              {sortedStates.map((s) => (
                <option key={s} value={s}>
                  {tStates(s as FindState)}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
          </div>
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-gray-700">
            {t("year")}
          </span>
          <div className="relative">
            <select
              value={current.year}
              onChange={(e) => update("year", e.currentTarget.value)}
              className={`${SELECT_CLS} w-full`}
            >
              <option value="">{tCommon("allShort")}</option>
              {options.years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
          </div>
        </label>
      </div>

      {hasAny && (
        <button
          type="button"
          onClick={clearAll}
          className="mt-3 text-sm text-brand-700 hover:underline"
        >
          {t("clearAll")}
        </button>
      )}
    </div>
  );
}
