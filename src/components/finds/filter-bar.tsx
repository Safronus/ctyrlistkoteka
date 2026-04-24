"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { FilterOptions } from "@/lib/queries/finds";
import { STATE_LABELS } from "@/lib/stateLabels";
import type { FindState } from "@prisma/client";

const INPUT_CLS =
  "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

export function FilterBar({
  options,
  current,
}: {
  options: FilterOptions;
  current: {
    q: string;
    locationId: string;
    state: string;
    leafCount: string;
    year: string;
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
    params.delete("page"); // reset pagination on filter change
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const clearAll = () => {
    startTransition(() => {
      router.push(pathname);
    });
  };

  const hasAny =
    current.q || current.locationId || current.state || current.leafCount || current.year;

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 transition-opacity ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="lg:col-span-2">
          <span className="mb-1 block text-xs font-medium text-gray-700">
            Hledat
          </span>
          <input
            type="search"
            defaultValue={current.q}
            placeholder="Poznámka nebo lokalita…"
            className={`${INPUT_CLS} w-full`}
            onChange={(e) => {
              // Lightweight debounce via input buffering the user types in.
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
            Lokalita
          </span>
          <select
            value={current.locationId}
            onChange={(e) => update("loc", e.currentTarget.value)}
            className={`${INPUT_CLS} w-full`}
          >
            <option value="">Všechny</option>
            {options.locations.map((l) => (
              <option key={l.id} value={String(l.id)}>
                {l.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-gray-700">
            Stav
          </span>
          <select
            value={current.state}
            onChange={(e) => update("state", e.currentTarget.value)}
            className={`${INPUT_CLS} w-full`}
          >
            <option value="">Všechny</option>
            {options.states.map((s) => (
              <option key={s} value={s}>
                {STATE_LABELS[s as FindState]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-gray-700">
            Lístků
          </span>
          <select
            value={current.leafCount}
            onChange={(e) => update("leafs", e.currentTarget.value)}
            className={`${INPUT_CLS} w-full`}
          >
            <option value="">Vše</option>
            {options.leafCounts.map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-gray-700">
            Rok
          </span>
          <select
            value={current.year}
            onChange={(e) => update("year", e.currentTarget.value)}
            className={`${INPUT_CLS} w-full`}
          >
            <option value="">Vše</option>
            {options.years.map((y) => (
              <option key={y} value={String(y)}>
                {y}
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
