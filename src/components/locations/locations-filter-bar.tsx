"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { LocationSort } from "@/lib/queries/locations";

const INPUT_CLS =
  "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

const SORT_LABELS: Record<LocationSort, string> = {
  id: "Podle ID",
  code: "Abecedně",
  finds: "Podle počtu nálezů",
};

export function LocationsFilterBar({
  cities,
  current,
}: {
  cities: readonly string[];
  current: {
    q: string;
    city: string;
    sort: LocationSort;
    showAnonymized: boolean;
    showGone: boolean;
  };
}) {
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

  const toggleFlag = (key: "showAnon" | "showGone", on: boolean) => {
    update(key, on ? "1" : "");
  };

  const clearAll = () => {
    startTransition(() => {
      router.push(pathname);
    });
  };

  const hasAny =
    current.q ||
    current.city ||
    current.sort !== "id" ||
    current.showAnonymized ||
    current.showGone;

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 transition-opacity ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label>
          <span className="mb-1 block text-xs font-medium text-gray-700">
            Hledat
          </span>
          <input
            type="search"
            defaultValue={current.q}
            placeholder="Kód, popis nebo katastr…"
            className={`${INPUT_CLS} w-full`}
            onChange={(e) => {
              const v = e.currentTarget.value;
              window.clearTimeout(
                (e.currentTarget as HTMLInputElement & {
                  _t?: ReturnType<typeof setTimeout>;
                })._t,
              );
              (
                e.currentTarget as HTMLInputElement & {
                  _t?: ReturnType<typeof setTimeout>;
                }
              )._t = setTimeout(() => update("q", v), 250);
            }}
          />
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-gray-700">
            Město
          </span>
          <select
            value={current.city}
            onChange={(e) => update("city", e.currentTarget.value)}
            className={`${INPUT_CLS} w-full`}
          >
            <option value="">Všechna</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-gray-700">
            Řazení
          </span>
          <select
            value={current.sort}
            onChange={(e) =>
              update("sort", e.currentTarget.value === "id" ? "" : e.currentTarget.value)
            }
            className={`${INPUT_CLS} w-full`}
          >
            {(Object.keys(SORT_LABELS) as LocationSort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-700">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={current.showAnonymized}
            onChange={(e) => toggleFlag("showAnon", e.currentTarget.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          <span>Zobrazit anonymizované</span>
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={current.showGone}
            onChange={(e) => toggleFlag("showGone", e.currentTarget.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          <span>Zobrazit zaniklé</span>
        </label>
        {hasAny && (
          <button
            type="button"
            onClick={clearAll}
            className="ml-auto text-sm text-brand-700 hover:underline"
          >
            Zrušit filtry
          </button>
        )}
      </div>
    </div>
  );
}
