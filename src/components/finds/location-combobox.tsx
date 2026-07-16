"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

export interface ComboLocation {
  id: number;
  label: string;
  city: string;
  country: string;
}

/**
 * Searchable location picker for the /sbirka "Lokalita" filter. A native
 * `<select>` with 200+ options is unusable, so this is a typeahead: a button
 * that opens a panel with a search box + filtered list.
 *
 * Matching is deliberately forgiving — `fold()` strips diacritics, case and
 * punctuation/whitespace off BOTH the query and each option, and the test is a
 * substring (matches anywhere, not just a prefix). So "sturovo", "ŠTÚROVO" and
 * "180" all find `ŠTÚROVO_SOBĚSKÉHO001` (#180). The id (raw + zero-padded) is
 * matched too, so the location's number works as a query.
 */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function LocationCombobox({
  locations,
  countries,
  selectedLabel,
  facets,
  onSelect,
  onClear,
  buttonCls,
  allLabel,
  searchPlaceholder,
  emptyLabel,
  formatCount,
}: {
  /** Cascade-narrowed list to search (already limited to the picked
   *  country/city, if any). */
  locations: ReadonlyArray<ComboLocation>;
  /** Localized `{ code, name }`, ordered — drives the country group headers
   *  (restoring the old `<optgroup>` grouping) and their order. */
  countries: ReadonlyArray<{ code: string; name: string }>;
  /** Label of the currently selected location, or null when none is set —
   *  resolved by the parent so it shows even if the cascade would hide it. */
  selectedLabel: string | null;
  facets: Record<number, number>;
  onSelect: (location: ComboLocation) => void;
  onClear: () => void;
  buttonCls: string;
  allLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
  formatCount: (n: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Close on outside click / Esc — same pattern as StateMultiSelect.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Focus the search box when the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => {
    const q = fold(query);
    const list = q
      ? locations.filter(
          (l) =>
            fold(l.label).includes(q) ||
            String(l.id).includes(q) ||
            String(l.id).padStart(5, "0").includes(q),
        )
      : locations;
    // Cap so a no-query open doesn't render 200 rows; a search narrows well
    // before this and the count line tells the user when it's truncated.
    return list.slice(0, 200);
  }, [locations, query]);

  // Group the filtered list by country, ordered by the `countries` list —
  // restoring the old <optgroup> grouping. Stray codes (incl. "" = no
  // country) are appended after the known ones.
  const grouped = useMemo(() => {
    const byCode = new Map<string, ComboLocation[]>();
    for (const l of filtered) {
      const arr = byCode.get(l.country);
      if (arr) arr.push(l);
      else byCode.set(l.country, [l]);
    }
    const order = countries.map((c) => c.code).filter((c) => byCode.has(c));
    for (const code of byCode.keys()) if (!order.includes(code)) order.push(code);
    const nameOf = new Map(countries.map((c) => [c.code, c.name]));
    return order.map((code) => ({
      code,
      name: nameOf.get(code) ?? "",
      items: byCode.get(code) ?? [],
    }));
  }, [filtered, countries]);

  // Grouped-flattened item order drives keyboard nav + each row's data-idx.
  const flatOrder = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);
  const idxById = useMemo(() => {
    const m = new Map<number, number>();
    flatOrder.forEach((l, i) => m.set(l.id, i));
    return m;
  }, [flatOrder]);

  useEffect(() => setActiveIdx(0), [query]);

  const choose = (l: ComboLocation) => {
    onSelect(l);
    setOpen(false);
    setQuery("");
  };
  const clear = () => {
    onClear();
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flatOrder.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const l = flatOrder[activeIdx];
      if (l) choose(l);
    }
  };

  // Keep the active row in view while arrow-navigating.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${buttonCls} flex items-center justify-between text-left`}
      >
        <span className={`truncate ${selectedLabel ? "" : "text-gray-400"}`}>
          {selectedLabel ?? allLabel}
        </span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
      </button>

      {open && (
        <div className="absolute left-0 z-20 mt-1 w-max min-w-full max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-gray-100 px-2.5">
            <Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="h-10 w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Vymazat"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <ul
            ref={listRef}
            className="max-h-64 overflow-auto overscroll-contain py-1 text-sm"
          >
            <li>
              <button
                type="button"
                onClick={clear}
                className="flex w-full items-center px-3 py-1.5 text-left text-gray-600 hover:bg-gray-50"
              >
                {allLabel}
              </button>
            </li>
            {grouped.map((g) => (
              <li key={g.code || "_none"}>
                {grouped.length > 1 && g.name && (
                  <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    {g.name}
                  </div>
                )}
                <ul>
                  {g.items.map((l) => {
                    const i = idxById.get(l.id) ?? 0;
                    return (
                      <li key={l.id}>
                        <button
                          type="button"
                          data-idx={i}
                          onClick={() => choose(l)}
                          onMouseEnter={() => setActiveIdx(i)}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left ${
                            i === activeIdx ? "bg-brand-50" : ""
                          }`}
                        >
                          <span className="min-w-0 break-words text-gray-900">
                            {l.label}
                          </span>
                          <span className="shrink-0 text-xs text-gray-400">
                            {formatCount(facets[l.id] ?? 0)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
            {flatOrder.length === 0 && (
              <li className="px-3 py-2 text-gray-400">{emptyLabel}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
