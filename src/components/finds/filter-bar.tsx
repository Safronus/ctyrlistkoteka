"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import type { FilterOptions } from "@/lib/queries/finds";
import { STATE_LABELS } from "@/lib/stateLabels";
import type { FindState } from "@prisma/client";

const INPUT_CLS =
  "h-10 rounded-lg border border-gray-200 bg-white px-3.5 text-sm text-gray-900 shadow-sm transition placeholder:text-gray-400 hover:border-gray-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";
const SELECT_CLS = `${INPUT_CLS} cursor-pointer appearance-none pr-10`;

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
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
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
            Hledat
          </span>
          <input
            type="search"
            value={qInput}
            placeholder="Poznámka nebo lokalita…"
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
            Stát
          </span>
          <div className="relative">
            <select
              value={current.country}
              onChange={(e) => update("country", e.currentTarget.value)}
              className={`${SELECT_CLS} w-full`}
            >
              <option value="">Všechny</option>
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
            Město
          </span>
          <div className="relative">
            <select
              value={current.city}
              onChange={(e) => update("city", e.currentTarget.value)}
              className={`${SELECT_CLS} w-full`}
            >
              <option value="">Všechna</option>
              {options.cities.map((c) => (
                <option key={c} value={c}>
                  {c}
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
            Lokalita
          </span>
          <div className="relative">
            <select
              value={current.locationId}
              onChange={(e) => update("loc", e.currentTarget.value)}
              className={`${SELECT_CLS} w-full`}
            >
              <option value="">Všechny</option>
              {options.locations.map((l) => (
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
            Stav
          </span>
          <div className="relative">
            <select
              value={current.state}
              onChange={(e) => update("state", e.currentTarget.value)}
              className={`${SELECT_CLS} w-full`}
            >
              <option value="">Všechny</option>
              {options.states.map((s) => (
                <option key={s} value={s}>
                  {STATE_LABELS[s as FindState]}
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
            Rok
          </span>
          <div className="relative">
            <select
              value={current.year}
              onChange={(e) => update("year", e.currentTarget.value)}
              className={`${SELECT_CLS} w-full`}
            >
              <option value="">Vše</option>
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
          Zrušit filtry
        </button>
      )}
    </div>
  );
}
