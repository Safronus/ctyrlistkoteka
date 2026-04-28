"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  ArrowDownAZ,
  ArrowDownNarrowWide,
  Compass,
  Globe,
  Hash,
} from "lucide-react";
import type { LocationSort } from "@/lib/queries/locations";

const INPUT_CLS =
  "rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-900 shadow-sm transition placeholder:text-gray-400 hover:border-gray-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";

// Order matches the segmented control left→right. `finds` is also the
// server default in parseSort/listLocations.
const SORT_OPTIONS: ReadonlyArray<{
  value: LocationSort;
  label: string;
  icon: React.ReactNode;
}> = [
  {
    value: "finds",
    label: "Nejvíce nálezů",
    icon: <ArrowDownNarrowWide className="h-4 w-4" />,
  },
  { value: "id", label: "Podle ID", icon: <Hash className="h-4 w-4" /> },
  {
    value: "code",
    label: "Abecedně",
    icon: <ArrowDownAZ className="h-4 w-4" />,
  },
  {
    value: "dist-asc",
    label: "Nejbližší",
    icon: <Compass className="h-4 w-4" />,
  },
  {
    value: "dist-desc",
    label: "Nejvzdálenější",
    icon: <Globe className="h-4 w-4" />,
  },
];

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
    current.sort !== "finds" ||
    current.showAnonymized ||
    current.showGone;

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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-700">
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
              className="text-sm text-brand-700 hover:underline"
            >
              Zrušit filtry
            </button>
          )}
        </div>

        <div
          role="group"
          aria-label="Řazení"
          className="inline-flex max-w-full overflow-x-auto rounded-md border border-gray-300 bg-white"
        >
          {SORT_OPTIONS.map((opt, i) => {
            const active = opt.value === current.sort;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() =>
                  update("sort", opt.value === "finds" ? "" : opt.value)
                }
                aria-pressed={active}
                className={`flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-sm transition ${
                  i > 0 ? "border-l border-gray-300" : ""
                } ${
                  active
                    ? "bg-brand-600 text-white"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
