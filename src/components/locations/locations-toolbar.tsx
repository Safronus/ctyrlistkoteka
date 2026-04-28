"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  Archive,
  ArrowDownAZ,
  ArrowDownNarrowWide,
  Compass,
  EyeOff,
  Globe,
  Hash,
} from "lucide-react";
import type { LocationSort } from "@/lib/queries/locations";

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

export function LocationsToolbar({
  current,
}: {
  current: {
    sort: LocationSort;
    showAnonymized: boolean;
    showGone: boolean;
    hasFilters: boolean;
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

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 transition-opacity ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ToggleButton
          pressed={current.showAnonymized}
          onClick={() =>
            toggleFlag("showAnon", !current.showAnonymized)
          }
          icon={<EyeOff className="h-4 w-4" />}
          label="Anonymizované"
        />
        <ToggleButton
          pressed={current.showGone}
          onClick={() => toggleFlag("showGone", !current.showGone)}
          icon={<Archive className="h-4 w-4" />}
          label="Zaniklé"
        />
        {current.hasFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="ml-1 text-sm text-brand-700 hover:underline"
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
  );
}

function ToggleButton({
  pressed,
  onClick,
  icon,
  label,
}: {
  pressed: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition ${
        pressed
          ? "border-brand-600 bg-brand-600 text-white shadow-sm"
          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
