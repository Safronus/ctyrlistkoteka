"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { LocationListItem } from "@/lib/queries/locations";
import { formatAreaM2, formatCount, formatLocationId, FINDS } from "@/lib/format";
import { paddedIdMatches, parseIdQuery } from "@/lib/search";

const INPUT_CLS =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 pl-8 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

/**
 * Scrollable list of locations rendered as a control inside the /mapa
 * sidebar. Anonymized locations are filtered out upstream (they aren't
 * on the map, and listing them with no click target was just noise);
 * former locations get a rose tone and a "Zaniklá" badge.
 */
export function MapSidebar({
  locations,
  focusId,
  onSelect,
  showLocations,
  onToggleLocations,
  showFinds,
  onToggleFinds,
  findCount,
}: {
  locations: readonly LocationListItem[];
  focusId: number | null;
  onSelect: (id: number) => void;
  showLocations: boolean;
  onToggleLocations: (v: boolean) => void;
  showFinds: boolean;
  onToggleFinds: (v: boolean) => void;
  findCount: number;
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return locations;
    // Numeric input also matches the location's display ID — exact (so
    // "0001" finds #00001) and substring of the padded form (so "0001"
    // additionally finds #00010-#00019).
    const idQuery = parseIdQuery(q);
    return locations.filter((l) => {
      if (idQuery !== null) {
        if (l.id === idQuery.exactId) return true;
        if (paddedIdMatches(l.id, idQuery.digits)) return true;
      }
      return (
        l.code.toLowerCase().includes(needle) ||
        l.displayName.toLowerCase().includes(needle) ||
        l.cadastralArea.toLowerCase().includes(needle)
      );
    });
  }, [locations, q]);

  return (
    <>
      <div className="border-b border-gray-200 p-3">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Vrstvy
        </h3>
        <div className="space-y-1">
          <LayerToggle
            label="Lokace"
            count={locations.length}
            checked={showLocations}
            onChange={onToggleLocations}
          />
          <LayerToggle
            label="Nálezy"
            count={findCount}
            checked={showFinds}
            onChange={onToggleFinds}
          />
        </div>
      </div>
      <div className="border-b border-gray-200 p-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Hledat kód, popis…"
            className={INPUT_CLS}
          />
        </div>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <li className="p-4 text-center text-sm text-gray-500">
            Žádné lokality.
          </li>
        ) : (
          filtered.map((l) => (
            <li key={l.id} className="border-b border-gray-100 last:border-b-0">
              <SidebarRow
                location={l}
                focused={focusId === l.id}
                onSelect={onSelect}
              />
            </li>
          ))
        )}
      </ul>
    </>
  );
}

function LayerToggle({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded px-1 py-1 text-sm text-gray-700 hover:bg-gray-50">
      <span className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
        />
        <span>{label}</span>
      </span>
      <span className="font-mono text-xs text-gray-500">
        ({count.toLocaleString("cs-CZ")})
      </span>
    </label>
  );
}

function SidebarRow({
  location,
  focused,
  onSelect,
}: {
  location: LocationListItem;
  focused: boolean;
  onSelect: (id: number) => void;
}) {
  const tone = location.isGone ? "bg-rose-50/60" : "";
  const focusedTone = focused ? "ring-2 ring-inset ring-brand-500" : "";

  return (
    <button
      type="button"
      onClick={() => onSelect(location.id)}
      className={`flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-brand-50 focus:bg-brand-50 focus:outline-none ${tone} ${focusedTone}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-xs text-gray-500">
            {formatLocationId(location.id)}
          </span>
          <span
            className="truncate text-sm font-semibold text-gray-900"
            title={location.code}
          >
            {location.code}
          </span>
          {location.isGone && (
            <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-800">
              Zaniklá
            </span>
          )}
        </div>
        {location.displayName && location.displayName !== location.code && (
          <p
            className="truncate text-xs text-gray-500"
            title={location.displayName}
          >
            {location.displayName}
          </p>
        )}
        <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-gray-500">
          <span className="font-medium text-brand-700">
            {formatCount(location.stats.total, FINDS)}
          </span>
          {location.polygonAreaM2 !== null && (
            <span>· {formatAreaM2(location.polygonAreaM2)}</span>
          )}
        </p>
      </div>
    </button>
  );
}
