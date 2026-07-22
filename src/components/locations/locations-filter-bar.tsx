"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";

const INPUT_CLS =
  "h-10 rounded-lg border border-gray-200 bg-white px-3.5 text-sm text-gray-900 shadow-sm transition placeholder:text-gray-400 hover:border-gray-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";
const SELECT_CLS = `${INPUT_CLS} cursor-pointer appearance-none pr-10`;

export function LocationsFilterBar({
  cities,
  countries,
  countryCounts,
  cityCounts,
  current,
  hasFilters,
}: {
  /** City + the country it sits in, so the two selects cascade the same
   *  way /sbirka's do (pick a city → its country pins; pick a country →
   *  the city list narrows). */
  cities: ReadonlyArray<{ name: string; country: string }>;
  countries: ReadonlyArray<{ code: string; name: string }>;
  /** Number of locations under each country (by ISO code) / city (by name),
   *  shown in parentheses after the option label. */
  countryCounts: Readonly<Record<string, number>>;
  cityCounts: Readonly<Record<string, number>>;
  current: { q: string; num: string; city: string; country: string };
  /** True when ANY filter (incl. the toolbar toggles) is active — drives
   *  the "Zrušit filtry" button, kept here to match /sbirka's placement
   *  (bottom of the filter card, not out in the toolbar). */
  hasFilters: boolean;
}) {
  const t = useTranslations("LocationsFilterBar");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Set/clear several params in one navigation — the country/city cascade
  // needs to change both at once (picking a city also pins its country).
  const updateMany = (entries: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(entries)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };
  const update = (key: string, value: string) => updateMany({ [key]: value });

  const clearAll = () => {
    // Keep the presentation param (sort) — it's orthogonal to filters —
    // and drop everything else, mirroring /sbirka's "Zrušit filtry".
    const params = new URLSearchParams();
    const sort = searchParams.get("sort");
    if (sort) params.set("sort", sort);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  // A selected city pins its country (even on a deep-link that only carries
  // `city`); `effectiveCountry` resolves it so the country select shows the
  // right value and the city list narrows accordingly.
  const effectiveCountry =
    current.country ||
    cities.find((c) => c.name === current.city)?.country ||
    "";
  const visibleCities = useMemo(
    () =>
      effectiveCountry
        ? cities.filter((c) => c.country === effectiveCountry)
        : cities,
    [cities, effectiveCountry],
  );

  /** "Zlín" + 12 → "Zlín (12)"; count omitted when undefined. */
  const withCount = (label: string, count: number | undefined): string =>
    count == null ? label : `${label} (${count})`;

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 transition-opacity ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* The old single "Hledat" field split into two within the same
            2-column slot: an EXACT location-number box (číslo, digits only)
            on the left + the classic text search on the right. Mirrors
            /sbirka's find-number / note split. */}
        <div className="flex gap-3 sm:col-span-2 lg:col-span-2">
          <label className="w-[44%] shrink-0 sm:w-48">
            <span className="mb-1 flex items-center gap-1 truncate text-xs font-medium text-gray-700">
              {t("searchByNumber")}
              <MapPin
                className="h-3.5 w-3.5 shrink-0 text-gray-400"
                aria-hidden
              />
            </span>
            <input
              type="text"
              inputMode="numeric"
              defaultValue={current.num}
              placeholder={t("searchByNumberPlaceholder")}
              className={`${INPUT_CLS} w-full`}
              onChange={(e) => {
                // Digits only — an exact location-number (číslo) lookup.
                const el = e.currentTarget as HTMLInputElement & {
                  _t?: ReturnType<typeof setTimeout>;
                };
                const v = el.value.replace(/[^\d]/g, "");
                if (el.value !== v) el.value = v;
                window.clearTimeout(el._t);
                el._t = setTimeout(() => update("num", v), 250);
              }}
            />
          </label>
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-xs font-medium text-gray-700">
              {t("search")}
            </span>
            <input
              type="search"
              defaultValue={current.q}
              placeholder={t("searchPlaceholder")}
              className={`${INPUT_CLS} w-full`}
              onChange={(e) => {
                const el = e.currentTarget as HTMLInputElement & {
                  _t?: ReturnType<typeof setTimeout>;
                };
                const v = el.value;
                window.clearTimeout(el._t);
                el._t = setTimeout(() => update("q", v), 250);
              }}
            />
          </label>
        </div>

        <label>
          <span className="mb-1 block text-xs font-medium text-gray-700">
            {t("country")}
          </span>
          <div className="relative">
            {/* Locked while a city is selected — the city pins its country;
                clear the city to unlock it. */}
            <select
              value={effectiveCountry}
              disabled={!!current.city}
              onChange={(e) =>
                updateMany({ country: e.currentTarget.value, city: "" })
              }
              className={`${SELECT_CLS} w-full disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400`}
            >
              <option value="">{tCommon("all")}</option>
              {countries
                .filter(
                  (c) =>
                    (countryCounts[c.code] ?? 0) > 0 ||
                    c.code === effectiveCountry,
                )
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {withCount(c.name, countryCounts[c.code])}
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
                  updateMany({ city: "" });
                } else {
                  // Selecting a city pins its country.
                  const country =
                    cities.find((c) => c.name === city)?.country ??
                    current.country;
                  updateMany({ city, country });
                }
              }}
              className={`${SELECT_CLS} w-full`}
            >
              <option value="">{tCommon("allAlt")}</option>
              {visibleCities
                .filter(
                  (c) =>
                    (cityCounts[c.name] ?? 0) > 0 || c.name === current.city,
                )
                .map((c) => (
                  <option key={c.name} value={c.name}>
                    {withCount(c.name, cityCounts[c.name])}
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

      {hasFilters && (
        <button
          type="button"
          onClick={clearAll}
          className="mt-3 text-sm text-brand-700 hover:underline"
        >
          {t("clearFilters")}
        </button>
      )}
    </div>
  );
}
