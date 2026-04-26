"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  HelpCircle,
  Layers,
  MapPin,
} from "lucide-react";
import type { LocationListItem } from "@/lib/queries/locations";
import { GpsValue } from "@/components/finds/gps-value";
import { STATE_BADGE, STATE_LABELS } from "@/lib/stateLabels";
import {
  formatAreaM2,
  formatCount,
  formatDateTimeCs,
  formatDistance,
  formatLocationId,
  formatTimeSinceCs,
  FINDS,
} from "@/lib/format";

export function LocationListRow({ location }: { location: LocationListItem }) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((o) => !o);

  // Whole row is the click/keyboard target. Using role=button instead of
  // <button> lets the GpsValue toggle (also a button) live inside without
  // creating an invalid nested-button — its own onClick already
  // stopPropagation()s.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  };

  // Hierarchy flag — only set for visible (non-anonymized) sub-parts. The
  // listLocations() query already nulls parentId on anonymized rows so
  // their parent association can't be inferred.
  const isChild = !location.isAnonymized && location.parentId !== null;

  // Anonymizace má přednost před zaniklou — privacy je tvrdší. Pokud
  // by lokalita byla obojí, render se chová jako anonymizovaná.
  const tone = location.isAnonymized
    ? "bg-purple-50/60 hover:bg-purple-100/60 focus:bg-purple-100/60"
    : location.isGone
      ? "bg-rose-50/60 hover:bg-rose-100/60 focus:bg-rose-100/60"
      : "hover:bg-brand-50 focus:bg-brand-50";

  // Visual nesting: a left border + extra left padding telegraphs the
  // parent/child relationship in the flat list. Tinted brand-50 keeps the
  // child distinguishable from a regular row even before hover.
  const indent = isChild
    ? "border-l-4 border-brand-200 bg-brand-50/40 pl-6 sm:pl-10"
    : "";

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={onKeyDown}
        aria-expanded={open}
        className={`flex w-full cursor-pointer items-stretch gap-4 p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${tone} ${indent}`}
      >
        <RowThumb location={location} />
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-1">
          <RowTitle location={location} isChild={isChild} />
          {!location.isAnonymized && (
            <>
              <RowMeta location={location} />
              {location.coordinates && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <GpsValue
                    lat={location.coordinates.lat}
                    lng={location.coordinates.lng}
                  />
                  {location.distanceFromDefault !== null && (
                    <span
                      className="text-xs text-gray-500"
                      title="Vzdušná vzdálenost od GPS středu lokační mapy 00001"
                    >
                      <span className="font-mono tabular-nums text-gray-800">
                        {formatDistance(location.distanceFromDefault)}
                      </span>{" "}
                      od MAP 00001
                    </span>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <RowCount location={location} />
                <MapLink location={location} />
              </div>
            </>
          )}
        </div>
        <div
          aria-hidden
          className="flex shrink-0 items-center text-gray-400"
        >
          {open ? (
            <ChevronDown className="h-5 w-5" />
          ) : (
            <ChevronRight className="h-5 w-5" />
          )}
        </div>
      </div>

      {open && <StatsPanel location={location} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Row pieces

function RowThumb({ location }: { location: LocationListItem }) {
  if (location.isAnonymized) {
    // Generic placeholder — the actual map must not be shown.
    return (
      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border border-purple-200 bg-purple-50 text-purple-400 sm:h-24 sm:w-24">
        <HelpCircle className="h-10 w-10" aria-hidden />
        <span className="sr-only">Anonymizovaná lokalita</span>
      </div>
    );
  }
  if (location.thumbnailUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={location.thumbnailUrl}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        className="h-20 w-20 shrink-0 rounded-md border border-gray-200 object-cover sm:h-24 sm:w-24"
      />
    );
  }
  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 text-2xl text-gray-300 sm:h-24 sm:w-24">
      🍀
    </div>
  );
}

function RowTitle({
  location,
  isChild,
}: {
  location: LocationListItem;
  isChild: boolean;
}) {
  // Parent badge: only shown for non-anonymized rows that actually have at
  // least one visible child after the showAnonymized/showGone filters.
  const showPartsBadge = !location.isAnonymized && location.childCount > 0;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      {isChild && (
        <CornerDownRight
          className="h-3.5 w-3.5 shrink-0 self-center text-brand-500"
          aria-label="Dílčí část lokality"
        />
      )}
      <span className="font-mono text-xs text-gray-500">
        {formatLocationId(location.id)}
      </span>
      <span
        className="truncate text-sm font-semibold text-gray-900"
        title={location.code}
      >
        {location.code}
      </span>
      {!location.isAnonymized &&
        location.displayName &&
        location.displayName !== location.code && (
          <span
            className="truncate text-sm text-gray-500"
            title={location.displayName}
          >
            ({location.displayName})
          </span>
        )}
      {showPartsBadge && (
        <span
          className="inline-flex items-center gap-1 rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-800"
          title="Lokalita je rozdělena na dílčí části"
        >
          <Layers className="h-3 w-3" aria-hidden />+ {location.childCount}{" "}
          {location.childCount === 1
            ? "část"
            : location.childCount < 5
              ? "části"
              : "částí"}
        </span>
      )}
      {location.isAnonymized && (
        <span className="rounded-md bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-purple-800">
          Anonymizovaná
        </span>
      )}
      {location.isGone && (
        <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-800">
          Zaniklá
        </span>
      )}
    </div>
  );
}

function RowMeta({ location }: { location: LocationListItem }) {
  // Druhý řádek: celý kód lokality (font-mono, ne split části — uživatel
  // viděl jen `cadastral · type` a chtěl celý code) + plocha polygonu.
  return (
    <p className="truncate text-xs text-gray-500">
      <span className="font-mono">{location.code}</span>
      {location.polygonAreaM2 !== null && (
        <> · {`Plocha ${formatAreaM2(location.polygonAreaM2)}`}</>
      )}
    </p>
  );
}

function MapLink({ location }: { location: LocationListItem }) {
  return (
    <Link
      href={`/mapa?focus=${location.id}`}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
    >
      <MapPin className="h-3.5 w-3.5" aria-hidden />
      <span>Zobrazit na mapě</span>
    </Link>
  );
}

function RowCount({ location }: { location: LocationListItem }) {
  // Master locations whose finds physically live on their sub-parts (e.g.
  // RATIBOŘ_POLE001 with 0 own finds but 953 across 001a–001g) would
  // otherwise read "0 nálezů" in the header — misleading. Use
  // aggregateStats which equals stats for leaf locations and the folded
  // total for parents.
  const hasChildren = location.childCount > 0;
  const view = location.aggregateStats;
  return (
    <p className="text-sm font-medium text-brand-700">
      {formatCount(view.total, FINDS)}
      {hasChildren && (
        <span className="ml-2 text-xs font-normal text-gray-500">
          (vč. dílčích částí)
        </span>
      )}
      {view.anonymized > 0 && (
        <span className="ml-2 text-xs text-purple-600">
          ({view.anonymized} anonymizovaných)
        </span>
      )}
    </p>
  );
}

// ---------------------------------------------------------------------------
//  Stats panel

function StatsPanel({ location }: { location: LocationListItem }) {
  if (location.isAnonymized) {
    return (
      <div className="border-t border-purple-200 bg-purple-50 px-3 py-4 text-sm text-purple-900 sm:px-6">
        Detail anonymizované lokality se nezobrazuje.
      </div>
    );
  }

  // The expanded panel renders the *combined* picture (location + every
  // visible sub-part) — `aggregateStats` equals `stats` for leaves, so the
  // same code path covers both cases. The own-vs-children split only
  // surfaces in SummaryRow's sub-line.
  const view = location.aggregateStats;
  const stateMax = view.states.reduce((m, s) => Math.max(m, s.count), 0);

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-3 py-4 sm:px-6">
      {view.total === 0 ? (
        <p className="text-sm text-gray-500">
          Pro tuto lokalitu zatím nejsou žádné nálezy.
        </p>
      ) : (
        <div className="space-y-4">
          <SummaryRow
            ownTotal={location.stats.total}
            aggregateTotal={view.total}
            firstFoundAt={view.firstFoundAt}
            lastFoundAt={view.lastFoundAt}
            childCount={location.childCount}
          />

          <DetailLinks
            firstFindId={view.firstFindId}
            lastFindId={view.lastFindId}
            locationId={location.id}
          />

          {view.states.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Stavy nálezů
              </h3>
              <ul className="space-y-1.5">
                {view.states.map((s) => (
                  <li key={s.state} className="flex items-center gap-2">
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${STATE_BADGE[s.state]}`}
                    >
                      {STATE_LABELS[s.state]}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{
                          width: stateMax > 0
                            ? `${(s.count / stateMax) * 100}%`
                            : "0%",
                        }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-gray-600">
                      {s.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  ownTotal,
  aggregateTotal,
  firstFoundAt,
  lastFoundAt,
  childCount,
}: {
  ownTotal: number;
  aggregateTotal: number;
  firstFoundAt: string | null;
  lastFoundAt: string | null;
  childCount: number;
}) {
  const first = firstFoundAt ? new Date(firstFoundAt) : null;
  const last = lastFoundAt ? new Date(lastFoundAt) : null;
  // Headline shows the combined total (matches the row header); the
  // sub-line splits it into own vs. children when this is a parent so
  // the visitor can still see both numbers.
  const hasChildren = childCount > 0;
  const totalSub = hasChildren
    ? `Vlastní: ${ownTotal} · Z dílčích částí: ${aggregateTotal - ownTotal}`
    : null;
  return (
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
      <Stat
        label="Celkem nálezů"
        value={String(aggregateTotal)}
        sub={totalSub}
      />
      <Stat
        label="První nález"
        value={first ? formatDateTimeCs(first) : "—"}
        sub={first ? formatTimeSinceCs(first) : null}
      />
      <Stat
        label="Poslední nález"
        value={last ? formatDateTimeCs(last) : "—"}
        sub={last ? formatTimeSinceCs(last) : null}
      />
    </dl>
  );
}

function DetailLinks({
  firstFindId,
  lastFindId,
  locationId,
}: {
  firstFindId: number | null;
  lastFindId: number | null;
  locationId: number;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {firstFindId !== null && (
        <Link
          href={`/sbirka/${firstFindId}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          První nález #{firstFindId} →
        </Link>
      )}
      {lastFindId !== null && lastFindId !== firstFindId && (
        <Link
          href={`/sbirka/${lastFindId}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          Poslední nález #{lastFindId} →
        </Link>
      )}
      <Link
        href={`/sbirka?loc=${locationId}`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
      >
        Vše ve sbírce →
      </Link>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-gray-900">{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-gray-500">{sub}</dd>}
    </div>
  );
}
