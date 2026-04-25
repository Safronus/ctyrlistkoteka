"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

const INPUT_CLS =
  "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

export function LocationsFilterBar({
  cities,
  current,
}: {
  cities: readonly string[];
  current: { q: string; city: string };
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

  const clearAll = () => {
    startTransition(() => {
      router.push(pathname);
    });
  };

  const hasAny = current.q || current.city;

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 transition-opacity ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
      </div>

      {hasAny && (
        <button
          type="button"
          onClick={clearAll}
          className="mt-3 text-sm text-brand-700 hover:underline"
        >
          Zrušit filtry
        </button>
      )}
    </div>
  );
}
