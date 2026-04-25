"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { LayoutGrid, List, ArrowDownNarrowWide, ArrowUpNarrowWide } from "lucide-react";
import type { FindSort } from "@/lib/queries/finds";

export type FindView = "grid" | "list";

export function ViewSortToolbar({
  view,
  sort,
}: {
  view: FindView;
  sort: FindSort;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const setParam = (key: string, value: string, defaultValue: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === defaultValue) params.delete(key);
    else params.set(key, value);
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 transition-opacity ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <Segmented
        label="Zobrazení"
        value={view}
        options={[
          { value: "grid", label: "Dlaždice", icon: <LayoutGrid className="h-4 w-4" /> },
          { value: "list", label: "Seznam", icon: <List className="h-4 w-4" /> },
        ]}
        onChange={(v) => setParam("view", v, "list")}
      />

      <Segmented
        label="Řazení"
        value={sort}
        options={[
          {
            value: "desc",
            label: "Nejnovější",
            icon: <ArrowDownNarrowWide className="h-4 w-4" />,
          },
          {
            value: "asc",
            label: "Nejstarší",
            icon: <ArrowUpNarrowWide className="h-4 w-4" />,
          },
        ]}
        onChange={(v) => setParam("sort", v, "desc")}
      />
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; icon: React.ReactNode }>;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-md border border-gray-300 bg-white"
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition ${
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
  );
}
