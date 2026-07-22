"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import type { FacetCounts, FilterOptions } from "@/lib/queries/finds";
import type { FindState } from "@/generated/prisma/enums";
import { RETIRED_STATES } from "@/lib/stateLabels";
import { StateMultiSelect } from "./state-multi-select";
import { LocationCombobox } from "./location-combobox";

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

/** Buckets items under their country, ordered like the Stát dropdown
 *  (`countries` order; any stray country not in that list is appended so
 *  nothing is ever dropped). Shared by the Město + Lokalita `<optgroup>`
 *  grouping — both carry each item's country code. */
function groupByCountry<T>(
  items: readonly T[],
  countryOf: (item: T) => string,
  countries: readonly { code: string; name: string }[],
): Array<{ code: string; name: string; items: T[] }> {
  const byCode = new Map<string, T[]>();
  for (const item of items) {
    const code = countryOf(item);
    const list = byCode.get(code) ?? [];
    list.push(item);
    byCode.set(code, list);
  }
  const codes = countries.map((c) => c.code).filter((code) => byCode.has(code));
  for (const code of byCode.keys()) if (!codes.includes(code)) codes.push(code);
  return codes.map((code) => ({
    code,
    name: countries.find((c) => c.code === code)?.name ?? code,
    items: byCode.get(code) ?? [],
  }));
}

export function FilterBar({
  options,
  facets,
  current,
  idPlaceholderExample,
}: {
  options: FilterOptions;
  /** Example number shown in the "Hledat podle čísla" placeholder. A little
   *  easter egg: the owner's two special finds by day-of-month parity —
   *  111 (heavenly) on odd days, 666 (hellish) on even ones. Computed
   *  server-side so there's no hydration mismatch. */
  idPlaceholderExample: number;
  /** Per-option match counts that react to the OTHER active filters.
   *  Each option shows its count and drops out of the list when zero
   *  (unless it's the current selection, which always stays visible). */
  facets: FacetCounts;
  current: {
    q: string;
    /** Exact find-number box value (the `?id=` param). */
    idQuery: string;
    locationId: string;
    city: string;
    country: string;
    states: FindState[];
    /** "Bez stavu" toggle — finds with no state at all. */
    noState: boolean;
    year: string;
    /** Whether a found-date range is active. The range picker lives in a
     *  separate toolbar (params from/to/fromTs/toTs), so the bar can't read
     *  it off its own fields — but `clearAll` clears it, so it must count
     *  toward `hasAny` or the "Zrušit filtry" button vanishes on a date-only
     *  filter (e.g. the homepage "Nejlepší den" deep-link). */
    hasDate: boolean;
  };
}) {
  const t = useTranslations("FilterBar");
  const tCommon = useTranslations("Common");
  const tStates = useTranslations("States");
  const locale = useLocale();
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
  // The exact-number box gets the same in-flight-preserving treatment as `q`
  // (see the long note above): its own state, debounce and last-pushed ref so
  // a fast typist's digits don't get wiped by our own URL round-trip.
  const [idInput, setIdInput] = useState(current.idQuery);
  const idDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedIdRef = useRef<string>(current.idQuery);
  useEffect(() => {
    if (current.idQuery === lastPushedIdRef.current) return;
    setIdInput(current.idQuery);
    lastPushedIdRef.current = current.idQuery;
  }, [current.idQuery]);
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (idDebounceRef.current) clearTimeout(idDebounceRef.current);
    },
    [],
  );

  const update = (key: string, value: string) => {
    if (key === "q") lastPushedRef.current = value;
    if (key === "id") lastPushedIdRef.current = value;
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

  // The state filter is multi-value (repeated `?state=`), so it needs its
  // own updater — updateMany only ever sets one value per key.
  const updateStates = (states: FindState[]) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("state");
    for (const s of states) params.append("state", s);
    params.delete("page");
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

  // Cascading geo filters. A selected city pins its country, and a
  // selected location pins BOTH its city and country — even on a deep-link
  // that only carries `loc` (the homepage "Top lokalita", /statistiky,
  // /lokality and /mapa all link to /sbirka?loc=X). So the Stát/Město
  // dropdowns reflect the location exactly the way picking it in the
  // Lokalita dropdown does, instead of sitting on "Všechny".
  const selectedLocation = current.locationId
    ? options.locations.find((l) => String(l.id) === current.locationId)
    : undefined;
  const effectiveCity = current.city || selectedLocation?.city || "";
  const effectiveCountry =
    current.country ||
    options.cities.find((c) => c.name === effectiveCity)?.country ||
    selectedLocation?.country ||
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
          (!effectiveCity || l.city === effectiveCity) &&
          // Drop locations that would yield nothing under the other active
          // filters (0 finds) — but always keep the current selection visible.
          ((facets.locations[l.id] ?? 0) > 0 ||
            String(l.id) === current.locationId),
      ),
    [
      options.locations,
      effectiveCountry,
      effectiveCity,
      facets.locations,
      current.locationId,
    ],
  );

  // Group the visible cities + locations by country so each flat list (when
  // no country is pinned) reads under country headers — both already carry
  // their country, mirroring the Stát filter. The current selection always
  // stays visible even at count 0. A single group (country/city pinned, or
  // one-country data) renders flat below, with no redundant header.
  const cityGroups = useMemo(
    () =>
      groupByCountry(
        visibleCities.filter(
          (c) => (facets.cities[c.name] ?? 0) > 0 || c.name === effectiveCity,
        ),
        (c) => c.country,
        options.countries,
      ),
    [visibleCities, facets.cities, effectiveCity, options.countries],
  );
  const nf = useMemo(
    () => new Intl.NumberFormat(locale === "en" ? "en-GB" : "cs-CZ"),
    [locale],
  );
  /** "Darovaný" + 123 → "Darovaný (123)"; count omitted when undefined. */
  const withCount = (label: string, count: number | undefined) =>
    count == null ? label : `${label} (${nf.format(count)})`;

  const hasAny =
    current.q ||
    current.idQuery ||
    current.locationId ||
    current.city ||
    current.country ||
    current.states.length ||
    current.noState ||
    current.year ||
    current.hasDate;

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 transition-opacity ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* The old single "Hledat" field, split into two within the same
            2-column slot (no extra filter row): an EXACT find-number box on
            the left + the note/location search on the right. */}
        <div className="flex gap-3 sm:col-span-2 lg:col-span-2">
          <label className="w-[42%] shrink-0 sm:w-40">
            <span className="mb-1 block truncate text-xs font-medium text-gray-700">
              {t("searchById")}
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={idInput}
              placeholder={t("searchByIdPlaceholder", {
                n: idPlaceholderExample,
              })}
              className={`${INPUT_CLS} w-full`}
              onChange={(e) => {
                // Digits only — the box is an exact find-ID lookup.
                const v = e.currentTarget.value.replace(/[^\d]/g, "");
                setIdInput(v);
                if (idDebounceRef.current) clearTimeout(idDebounceRef.current);
                idDebounceRef.current = setTimeout(() => update("id", v), 250);
              }}
            />
          </label>
          <label className="min-w-0 flex-1">
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
        </div>

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
              disabled={!!effectiveCity}
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
              {options.countries
                .filter(
                  (c) =>
                    (facets.countries[c.code] ?? 0) > 0 ||
                    c.code === effectiveCountry,
                )
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {withCount(c.name, facets.countries[c.code])}
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
              value={effectiveCity}
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
              {cityGroups.length > 1
                ? cityGroups.map((g) => (
                    <optgroup key={g.code} label={g.name}>
                      {g.items.map((c) => (
                        <option key={c.name} value={c.name}>
                          {withCount(titleCase(c.name), facets.cities[c.name])}
                        </option>
                      ))}
                    </optgroup>
                  ))
                : cityGroups
                    .flatMap((g) => g.items)
                    .map((c) => (
                      <option key={c.name} value={c.name}>
                        {withCount(titleCase(c.name), facets.cities[c.name])}
                      </option>
                    ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
          </div>
        </label>

        <div className="sm:col-span-2 lg:col-span-2">
          <span className="mb-1 block text-xs font-medium text-gray-700">
            {t("location")}
          </span>
          {/* Searchable typeahead — 200+ locations are unusable in a native
              <select>. Picking one pins its city + country so the three stay
              consistent; the list is already narrowed by any picked
              country/city (visibleLocations). */}
          <LocationCombobox
            locations={visibleLocations}
            countries={options.countries}
            selectedLabel={selectedLocation?.label ?? null}
            facets={facets.locations}
            onSelect={(l) =>
              updateMany({
                loc: String(l.id),
                city: l.city,
                country: l.country,
              })
            }
            onClear={() => update("loc", "")}
            buttonCls={`${INPUT_CLS} w-full`}
            allLabel={tCommon("all")}
            searchPlaceholder={t("locationSearchPlaceholder")}
            emptyLabel={t("locationSearchEmpty")}
            formatCount={(n) => nf.format(n)}
          />
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-gray-700">
            {t("state")}
          </span>
          <StateMultiSelect
            available={sortedStates}
            selected={current.states}
            counts={facets.states}
            formatCount={(n) => nf.format(n)}
            onChange={updateStates}
            selectCls={`${SELECT_CLS} w-full`}
            allLabel={tCommon("all")}
            noState={{
              label: t("noState"),
              count: facets.noState,
              selected: current.noState,
              onToggle: () =>
                updateMany({ nostate: current.noState ? "" : "1" }),
            }}
          />
        </div>

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
              {options.years
                .filter(
                  (y) => (facets.years[y] ?? 0) > 0 || String(y) === current.year,
                )
                .map((y) => (
                  <option key={y} value={String(y)}>
                    {withCount(String(y), facets.years[y])}
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
