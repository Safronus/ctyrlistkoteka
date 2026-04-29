"use client";

import { useMemo, useState } from "react";
import { Eye, EyeOff, Search } from "lucide-react";
import type { LocationListItem } from "@/lib/queries/locations";
import { formatAreaM2, formatCount, formatLocationId, FINDS } from "@/lib/format";
import { paddedIdMatches, parseIdQuery } from "@/lib/search";

const INPUT_CLS =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 pl-8 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

/**
 * Scrollable list of locations rendered as a control inside the /mapa
 * sidebar. Anonymized locations are filtered out upstream (they aren't
 * on the map, and listing them with no click target was just noise);
 * former locations get a rose tone and a "Zaniklá" badge. Layer toggles
 * (Lokace / Nálezy) live OUTSIDE this panel so they stay visible even
 * with the panel collapsed — see `LayerToggleCard` in `mapa-shell.tsx`.
 */
export function MapSidebar({
  locations,
  focusId,
  onSelect,
  enabledChildPolygonIds,
  onToggleChildPolygon,
}: {
  locations: readonly LocationListItem[];
  focusId: number | null;
  onSelect: (id: number) => void;
  /** IDs of child locations whose polygons are currently visible. */
  enabledChildPolygonIds: ReadonlySet<number>;
  /** Toggle the polygon visibility for one child location. Independent
   *  from the focus selection — picking a row in the list also enables
   *  its polygon, but the user can flip individual children on/off
   *  here without changing the focused location. */
  onToggleChildPolygon: (id: number) => void;
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
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-gray-200 px-3 py-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Lokality ({locations.length.toLocaleString("cs-CZ")})
        </h3>
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
            <li
              key={l.id}
              className="border-b border-gray-100 last:border-b-0"
            >
              <SidebarRow
                location={l}
                focused={focusId === l.id}
                onSelect={onSelect}
                polygonEnabled={enabledChildPolygonIds.has(l.id)}
                onTogglePolygon={onToggleChildPolygon}
              />
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function SidebarRow({
  location,
  focused,
  onSelect,
  polygonEnabled,
  onTogglePolygon,
}: {
  location: LocationListItem;
  focused: boolean;
  onSelect: (id: number) => void;
  polygonEnabled: boolean;
  onTogglePolygon: (id: number) => void;
}) {
  // Sub-part indent + parent "+ N částí" badge mirror /lokality so the
  // hierarchy reads the same on both pages. Anonymized rows aren't on
  // /mapa, so we don't have to guard the parent association — the
  // listLocations() query already nulled parentId on those rows.
  const isChild = location.parentId !== null;
  const hasParts = location.childCount > 0;
  // The polygon toggle only makes sense on child rows that actually
  // have a polygon recorded — top-level locations are always shown,
  // and a child without a polygon has nothing to switch on.
  const showPolygonToggle = isChild && location.polygonAreaM2 !== null;

  const tone = location.isGone ? "bg-rose-50/60" : "";
  const focusedTone = focused ? "ring-2 ring-inset ring-brand-500" : "";
  const indent = isChild
    ? "border-l-4 border-brand-200 bg-brand-50/40 pl-5"
    : "pl-3";

  // Parents fold their visible children's totals in via `aggregateStats`,
  // so the count next to a master location shows the combined "true"
  // activity (own + sub-parts). Leaves have aggregateStats === stats so
  // the read is identical for them.
  const findsTotal = hasParts
    ? location.aggregateStats.total
    : location.stats.total;

  // Two sibling controls instead of nesting buttons (HTML forbids that
  // and screen readers handle siblings cleanly). The main row button
  // takes flex-1 + min-w-0 so it can shrink below its content's
  // intrinsic width — without min-w-0 the long sub-part description
  // ("…hlavní ultimátní naleziště (levá hrana)") would push the row
  // wider than the sidebar and the toggle would slide off-screen.
  return (
    <div
      className={`flex w-full items-stretch overflow-hidden ${tone} ${focusedTone}`}
    >
      <button
        type="button"
        onClick={() => onSelect(location.id)}
        className={`flex min-w-0 flex-1 items-start gap-2 py-2 text-left transition hover:bg-brand-50 focus:bg-brand-50 focus:outline-none ${indent} ${showPolygonToggle ? "pr-1" : "pr-3"}`}
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
            {hasParts && (
              <span
                className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-800"
                title={`${location.childCount} sub-části`}
              >
                + {location.childCount}{" "}
                {location.childCount === 1
                  ? "část"
                  : location.childCount < 5
                    ? "části"
                    : "částí"}
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
              {formatCount(findsTotal, FINDS)}
            </span>
            {location.polygonAreaM2 !== null && (
              <span>· {formatAreaM2(location.polygonAreaM2)}</span>
            )}
          </p>
        </div>
      </button>
      {showPolygonToggle && (
        <button
          type="button"
          onClick={() => onTogglePolygon(location.id)}
          aria-pressed={polygonEnabled}
          aria-label={
            polygonEnabled
              ? "Skrýt polygon této části"
              : "Zobrazit polygon této části"
          }
          title={
            polygonEnabled
              ? "Skrýt polygon této části"
              : "Zobrazit polygon této části"
          }
          className={`flex shrink-0 items-center justify-center px-2 transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 ${
            polygonEnabled
              ? "text-brand-700 hover:bg-brand-100"
              : "text-gray-400 hover:bg-brand-50 hover:text-brand-700"
          }`}
        >
          {polygonEnabled ? (
            <Eye className="h-4 w-4" aria-hidden />
          ) : (
            <EyeOff className="h-4 w-4" aria-hidden />
          )}
        </button>
      )}
    </div>
  );
}
